# Food-band foothold screen

Seed 1202; foothold-band mode; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Food starts at 20 everywhere and persists. Each pulse offers 768 units to both bands: 96 units each continuously, plus 576 to the majority band alternating every 100 pulses (672/96 total). The fixed floor reaches 288 distinct tiles per band; total reachable supply is 2,016 per band, not all 2,304 geometric tiles. Historical alternating reference deltas are descriptive only; the historical comparison does not establish a general causal benefit of the floor.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 114 | 103 | 32/500 | 56/500 | 18/0 | 29–48 | 48/596 | 11 | 76800/32772/44028 | 81 / 456 |
| 2001–2500 | 500/500 (complete) | 77 | 90 | 8/500 | 8/500 | 0/0 | 23–48 | 35/468 | 13 | 76800/41096/35704 | 243 / 177 |
| 2501–3000 | 500/500 (complete) | 92 | 93 | 23/500 | 31/500 | 11/0 | 27–48 | 34/589 | 15 | 76800/45052/31748 | 113 / 406 |

Numerical screen: pass.
Both-band occupancy screen: pass (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).
Seasonal response screen: pass; blocks: 1500–2000 majority=1 deltas=[-319,239] pass; 2000–2500 majority=0 deltas=[162,-279] pass; 2500–3000 majority=1 deltas=[-130,229] pass.
Historical alternating descriptive deltas: 1500–2000 [-579,0] does not meet screen; 2000–2500 [142,0] does not meet screen; 2500–3000 [-110,0] does not meet screen. Historical baseline comparisons do not change the foothold status.
Historical alternating baseline regression: verified; compared all 151 samples, 151 frames, 3000 tick rows and 7 snapshots.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.
This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.
