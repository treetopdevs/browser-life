# Moving-food paired screen

Seed 1201; mode Uniform replenishment; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
The moving band changes replenishment destinations only. Food already on a tile remains when the band moves. This is not a matched usable-energy or stationary-band comparison.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 110 | 94 | 33/500 | 58/500 | 26/0 | 31–48 | 48/626 | 11 | 76800/29237/47563 | 276 (44.1%) |
| 2001–2500 | 500/500 (complete) | 82 | 91 | 44/500 | 62/500 | 39/0 | 31–48 | 39/639 | 13 | 76800/38252/38548 | 233 (36.5%) |
| 2501–3000 | 500/500 (complete) | 94 | 94 | 6/500 | 24/500 | 13/0 | 29–48 | 39/629 | 15 | 76800/44986/31814 | 397 (63.1%) |

Numerical screen: pass; this does not make a visual decision.
Uniform prefix: verified; artifact data SHA-256 30775b3db7278244157b03e55769c5189ddd72b62e5fa98973385e5f31bc577d.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
