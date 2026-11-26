# Uniform food longevity screen

Seed 1202; Node 24.2.0 on darwin/arm64.
Uniform food, mutation enabled; stopped at 6000.
Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2501–3000 | 500/500 | 90 | 88 | 30/500 | 59/500 | 24 | 0 | 29–48 | 41/706 |
| 3501–4000 | 500/500 | 102 | 81 | 5/500 | 10/500 | 3 | 0 | 22–48 | 48/594 |
| 4501–5000 | 500/500 | 91 | 89 | 24/500 | 60/500 | 26 | 0 | 31–48 | 41/754 |
| 5501–6000 | 500/500 | 100 | 95 | 13/500 | 20/500 | 11 | 0 | 22–48 | 41/538 |

Numerical gate: pass. Manual visual decision is separate and compares adjacent 3000→4000→5000→6000 frames.
Prefix: not-applicable; artifact SHA-256 4dff34b745ac6d77394c6a4411db0764d8f286deb58dcd9d47638899437dbb81.
Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.
No claim of adaptation, fitness improvement, or general survival benefit.
