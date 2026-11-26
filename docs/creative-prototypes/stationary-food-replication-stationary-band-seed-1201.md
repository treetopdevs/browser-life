# Stationary-food paired screen

Seed 1201; mode Stationary 48-column replenishment band at column 0; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Both arms replenish the same 48-column band with the same pulse budget. The moving band shifts every 50 ticks; the stationary band stays at left edge 0. Food already on a tile remains when the moving band shifts. Offered food is matched while both arms are active, but accepted food can differ.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied cells in band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 99 | 91 | 20/500 | 34/500 | 40/0 | 27–48 | 43/565 | 9 | 76800/44543/32257 | 531 (94.0%) |
| 2001–2500 | 500/500 (complete) | 83 | 85 | 23/500 | 44/500 | 29/0 | 25–48 | 41/618 | 11 | 76800/49133/27667 | 590 (95.5%) |
| 2501–3000 | 500/500 (complete) | 92 | 94 | 5/500 | 13/500 | 2/0 | 26–48 | 39/641 | 13 | 76800/49634/27166 | 610 (95.2%) |

Numerical screen: pass; this does not make a visual decision.
Moving-band historical prefix: not-applicable; reference artifact SHA-256 46017d1db1eaf1ff85b8cc51d92533d928aeac18b3e7cf261a82bb9d0d0816bf.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. A not-reached window is unavailable, not a simulated zero. Occupied-band share is descriptive and is not a fitness score.
This screen does not establish tracking, adaptation, fitness improvement, or superiority.
