# Uniform food longevity screen

Seed 1201; Node 24.2.0 on darwin/arm64.
Uniform food, mutation enabled; stopped at 6000.
Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2501–3000 | 500/500 | 94 | 94 | 6/500 | 24/500 | 13 | 0 | 29–48 | 39/629 |
| 3501–4000 | 500/500 | 111 | 102 | 18/500 | 35/500 | 11 | 0 | 29–48 | 48/692 |
| 4501–5000 | 500/500 | 87 | 93 | 19/500 | 37/500 | 25 | 0 | 28–48 | 32/564 |
| 5501–6000 | 500/500 | 107 | 106 | 33/500 | 41/500 | 22 | 0 | 24–48 | 36/450 |

Numerical gate: pass. Manual visual decision is separate and compares adjacent 3000→4000→5000→6000 frames.
Prefix: verified; artifact SHA-256 39ddc124f20f7e61d7d125e877c125a502941e65ddbdd159c1ee666b663b1c76.
Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.
No claim of adaptation, fitness improvement, or general survival benefit.
