# Alternating-food replication screen

Seed 1202; alternating-band mode; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Food starts at 20 everywhere and persists. Each pulse offers 768 units to one 24-column band: band 0 (columns 0–23) and band 1 (columns 48–71) alternate every 100 pulses. Static split reference deltas are descriptive only; if they meet the same seasonal threshold, alternating supply did not distinguish that pattern.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 58 | 94 | 2/500 | 6/500 | 11/0 | 3–48 | 6/74 | 9 | 76800/2968/73832 | 74 / 0 |
| 2001–2500 | 500/500 (complete) | 25 | 15 | 0/500 | 0/500 | 0/0 | 5–18 | 16/233 | 12 | 76800/55309/21491 | 216 / 0 |
| 2501–3000 | 500/500 (complete) | 31 | 40 | 0/500 | 0/500 | 0/0 | 6–20 | 7/142 | 15 | 76800/0/76800 | 106 / 0 |

Numerical screen: pass.
Both-band occupancy screen: fail (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).
Seasonal response screen: fail; blocks: 1500–2000 fed=1 deltas=[-579,0] fail; 2000–2500 fed=0 deltas=[142,0] fail; 2500–3000 fed=1 deltas=[-110,0] fail.
Static split descriptive deltas: 1500–2000 [35,-179] does not meet screen; 2000–2500 [-201,95] does not meet screen; 2500–3000 [-10,28] does not meet screen. Static baseline comparisons do not change the alternating-food status.
Static split baseline regression: verified; compared all 151 samples, 151 frames, 3000 tick rows and 5 snapshots.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.
This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.
