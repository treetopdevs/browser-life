# Stationary-food paired screen

Seed 1202; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Both arms replenish the same 48-column band with the same pulse budget. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 91 | 79 | 24/500 | 41/500 | 56/0 | 30–48 | 48/786 | 9 | 76800/46327/30473 | 726 (92.4%) |
| 2001–2500 | 500/500 (complete) | 85 | 93 | 38/500 | 42/500 | 35/0 | 27–48 | 40/679 | 11 | 76800/47280/29520 | 622 (91.6%) |
| 2501–3000 | 500/500 (complete) | 87 | 89 | 17/500 | 23/500 | 21/0 | 30–48 | 38/635 | 13 | 76800/50586/26214 | 560 (88.2%) |

Numerical screen: pass; this does not make a visual decision.
Moving-band historical prefix: verified; reference artifact SHA-256 183d90f551dcaf6c29ab4f397bba52d93365c22ad3315787423a49926a792a83.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
