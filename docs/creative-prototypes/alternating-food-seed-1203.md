# Alternating-food screen

Seed 1203; alternating-band mode; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Food starts at 20 everywhere and persists. Each pulse offers 768 units to one 24-column band: band 0 (columns 0–23) and band 1 (columns 48–71) alternate every 100 pulses. Static split reference deltas are descriptive only; if they meet the same seasonal threshold, alternating supply did not distinguish that pattern.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 102 | 90 | 13/500 | 17/500 | 19/0 | 24–48 | 48/722 | 11 | 76800/16063/60737 | 88 / 539 |
| 2001–2500 | 500/500 (complete) | 60 | 97 | 10/500 | 23/500 | 7/0 | 11–48 | 11/180 | 13 | 76800/48320/28480 | 79 / 65 |
| 2501–3000 | 500/500 (complete) | 52 | 32 | 0/500 | 0/500 | 0/0 | 8–36 | 31/515 | 15 | 76800/36616/40184 | 155 / 262 |

Numerical screen: pass.
Both-band occupancy screen: pass (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).
Seasonal response screen: pass; blocks: 1500–2000 fed=1 deltas=[-431,423] pass; 2000–2500 fed=0 deltas=[-9,-474] fail; 2500–3000 fed=1 deltas=[76,197] fail.
Static split descriptive deltas: 1500–2000 [95,1] does not meet screen; 2000–2500 [-89,-117] does not meet screen; 2500–3000 [-164,283] also meets screen. Static baseline comparisons do not change the alternating-food status.
Static split baseline regression: verified; compared all 151 samples, 151 frames, 3000 tick rows and 5 snapshots.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.
This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.
