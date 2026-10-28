# Moving-food paired screen

Seed 1203; mode Uniform replenishment; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
The moving band changes replenishment destinations only. Food already on a tile remains when the band moves. This is not a matched usable-energy or stationary-band comparison.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 102 | 87 | 17/500 | 32/500 | 29/0 | 25–48 | 43/548 | 10 | 76800/32623/44177 | 190 (34.7%) |
| 2001–2500 | 500/500 (complete) | 81 | 79 | 32/500 | 61/500 | 46/0 | 31–48 | 45/707 | 12 | 76800/41169/35631 | 299 (42.3%) |
| 2501–3000 | 500/500 (complete) | 86 | 96 | 14/500 | 28/500 | 18/0 | 21–48 | 35/544 | 15 | 76800/47035/29765 | 166 (30.5%) |

Numerical screen: pass; this does not make a visual decision.
Uniform prefix: verified; artifact data SHA-256 20049ecada2006718dc10e9aab7e7e239a0680bbb560d12ac10ac6bfcff474e5.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
