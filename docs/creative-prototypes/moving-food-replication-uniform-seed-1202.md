# Moving-food paired screen

Seed 1202; mode Uniform replenishment; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
The moving band changes replenishment destinations only. Food already on a tile remains when the band moves. This is not a matched usable-energy or stationary-band comparison.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 99 | 90 | 15/500 | 49/500 | 43/0 | 29–48 | 48/658 | 11 | 76800/31281/45519 | 260 (39.5%) |
| 2001–2500 | 500/500 (complete) | 89 | 98 | 16/500 | 51/500 | 27/0 | 30–48 | 39/666 | 13 | 76800/40297/36503 | 423 (63.5%) |
| 2501–3000 | 500/500 (complete) | 90 | 88 | 30/500 | 59/500 | 24/0 | 29–48 | 41/706 | 15 | 76800/47337/29463 | 220 (31.2%) |

Numerical screen: pass; this does not make a visual decision.
Uniform prefix: verified; artifact data SHA-256 c9d662b408789d572f80def545acf9925e205011c2ac5046b95022b6634e7cde.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
