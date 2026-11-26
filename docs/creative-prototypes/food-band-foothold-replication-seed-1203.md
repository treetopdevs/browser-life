# Food-band foothold screen

Seed 1203; foothold-band mode; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Food starts at 20 everywhere and persists. Each pulse offers 768 units to both bands: 96 units each continuously, plus 576 to the majority band alternating every 100 pulses (672/96 total). The fixed floor reaches 288 distinct tiles per band; total reachable supply is 2,016 per band, not all 2,304 geometric tiles. Historical alternating reference deltas are descriptive only; the historical comparison does not establish a general causal benefit of the floor.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 98 | 84 | 7/500 | 21/500 | 15/0 | 23–48 | 48/756 | 11 | 76800/21237/55563 | 100 / 529 |
| 2001–2500 | 500/500 (complete) | 99 | 105 | 12/500 | 29/500 | 8/0 | 29–48 | 42/587 | 13 | 76800/38526/38274 | 250 / 258 |
| 2501–3000 | 500/500 (complete) | 63 | 89 | 0/500 | 0/500 | 0/0 | 13–45 | 16/278 | 15 | 76800/46534/30266 | 42 / 218 |

Numerical screen: pass.
Both-band occupancy screen: pass (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).
Seasonal response screen: pass; blocks: 1500–2000 majority=1 deltas=[-220,334] pass; 2000–2500 majority=0 deltas=[150,-271] pass; 2500–3000 majority=1 deltas=[-208,-40] fail.
Historical alternating descriptive deltas: 1500–2000 [-431,423] also meets screen; 2000–2500 [-9,-474] does not meet screen; 2500–3000 [76,197] does not meet screen. Historical baseline comparisons do not change the foothold status.
Historical alternating baseline regression: verified; compared all 151 samples, 151 frames, 3000 tick rows and 7 snapshots.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.
This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.
