# Uniform food longevity screen

Seed 1203; Node 24.2.0 on darwin/arm64.
Uniform food, mutation enabled; stopped at 6000.
Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2501–3000 | 500/500 | 86 | 96 | 14/500 | 28/500 | 18 | 0 | 21–48 | 35/544 |
| 3501–4000 | 500/500 | 98 | 83 | 20/500 | 39/500 | 39 | 0 | 27–48 | 48/698 |
| 4501–5000 | 500/500 | 92 | 93 | 5/500 | 18/500 | 14 | 0 | 25–48 | 42/750 |
| 5501–6000 | 500/500 | 84 | 74 | 0/500 | 0/500 | 0 | 0 | 20–37 | 37/486 |

Numerical gate: pass. Manual visual decision is separate and compares adjacent 3000→4000→5000→6000 frames.
Prefix: not-applicable; artifact SHA-256 858bcf1f71057641184cf884cd2dbc8eca6b437fc5875db9677dbd25b6a2d75b.
Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.
No claim of adaptation, fitness improvement, or general survival benefit.
