# Split-food screen

Seed 1203; split-band mode; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Food is offered to columns 0–23 and 48–71, for 4,608 fixed target tiles total. The two 24-column bands have equal area to the historical contiguous 48-column stationary band; they change which physical tiles receive pulses. Food starts at 20 on every tile and remains after deposition. Each pulse offers 768 units, 384 to each band.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 94 | 82 | 19/500 | 39/500 | 44/0 | 27–48 | 48/693 | 9 | 76800/43963/32837 | 379 / 282 |
| 2001–2500 | 500/500 (complete) | 81 | 96 | 16/500 | 24/500 | 27/0 | 23–48 | 33/498 | 12 | 76800/47386/29414 | 290 / 165 |
| 2501–3000 | 500/500 (complete) | 89 | 87 | 2/500 | 9/500 | 3/0 | 24–48 | 35/620 | 14 | 76800/47114/29686 | 126 / 448 |

Numerical screen: pass.
Both-band occupancy screen: pass (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).
Contiguous stationary baseline regression: verified; compared all 151 samples, 151 frames, 3000 tick rows and 5 snapshots.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.
This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.
