# Split-food screen

Seed 1202; split-band mode; Node 24.2.0 on darwin/arm64.
Mutation enabled; stopped at tick 3000.
Food is offered to columns 0–23 and 48–71, for 4,608 fixed target tiles total. The two 24-column bands have equal area to the historical contiguous 48-column stationary band; they change which physical tiles receive pulses. Food starts at 20 on every tile and remains after deposition. Each pulse offers 768 units, 384 to each band.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Blocked cap/space | Population min–max | Endpoint pop/cells | Max-ever generation | Food offered/accepted/overflow | Occupied tiles in each band |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- | --- |
| 1501–2000 | 500/500 (complete) | 101 | 92 | 17/500 | 52/500 | 30/0 | 29–48 | 42/556 | 10 | 76800/43511/33289 | 320 / 167 |
| 2001–2500 | 500/500 (complete) | 90 | 100 | 0/500 | 0/500 | 0/0 | 21–46 | 32/435 | 13 | 76800/46530/30270 | 119 / 262 |
| 2501–3000 | 500/500 (complete) | 75 | 80 | 0/500 | 0/500 | 0/0 | 20–38 | 27/426 | 15 | 76800/43423/33377 | 109 / 290 |

Numerical screen: pass.
Both-band occupancy screen: pass (at least 10 occupied body tiles in each band at ticks 2,500 and 3,000).
Contiguous stationary baseline regression: verified; compared all 151 samples, 151 frames, 3000 tick rows and 5 snapshots.
Frames are saved every 20 actual ticks and at an off-cadence extinction tick when needed. Missing endpoints and partial windows fail; no post-extinction states are fabricated.
This screen does not establish adaptation, improved fitness, durable coexistence, or independent colonies.
