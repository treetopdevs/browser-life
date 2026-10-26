# Moving-food paired screen

Seed 1203; mode Moving 48-column replenishment band; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
The moving band changes replenishment destinations only. Food already on a tile remains when the band moves. This is not a matched usable-energy or stationary-band comparison.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 99 | 86 | 15/500 | 25/500 | 33/0 | 29–48 | 48/697 | 9 | 76800/42619/34181 | 654 (93.8%) |
| 2001–2500 | 500/500 (complete) | 77 | 83 | 17/500 | 46/500 | 50/0 | 31–48 | 42/634 | 11 | 76800/45743/31057 | 556 (87.7%) |
| 2501–3000 | 500/500 (complete) | 89 | 91 | 11/500 | 40/500 | 18/0 | 28–48 | 40/678 | 13 | 76800/48147/28653 | 601 (88.6%) |

Numerical screen: pass; this does not make a visual decision.
Uniform prefix: not-applicable; artifact data SHA-256 eb8a0985950d5de4450b1a911bd602761644a3adb96a9bd8265c5fd1e5af572e.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
