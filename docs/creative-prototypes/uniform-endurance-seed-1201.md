# Uniform food endurance screen

Seed 1201; Node 24.2.0 on darwin/arm64.
Uniform food, mutation enabled; stopped at 9000.
Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 5501–6000 | 500/500 | 107 | 106 | 33/500 | 41/500 | 22 | 0 | 24–48 | 36/450 |
| 6501–7000 | 500/500 | 81 | 88 | 22/500 | 34/500 | 31 | 0 | 27–48 | 33/543 |
| 7501–8000 | 500/500 | 95 | 100 | 16/500 | 31/500 | 17 | 0 | 21–48 | 33/423 |
| 8501–9000 | 500/500 | 91 | 97 | 7/500 | 20/500 | 2 | 0 | 24–48 | 36/613 |

Numerical gate: pass. Manual visual decision is separate and compares adjacent 6000→7000→8000→9000 frames.
Prefix: verified through 6000; artifact SHA-256 12b25a118166c3b0e9270d73b95a013c03c1a8afc7a12328f36fafd6374e496e.
Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.
No claim of adaptation, fitness improvement, or general survival benefit.
