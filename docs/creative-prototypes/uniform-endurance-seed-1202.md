# Uniform food endurance screen

Seed 1202; Node 24.2.0 on darwin/arm64.
Uniform food, mutation enabled; stopped at 9000.
Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 5501–6000 | 500/500 | 100 | 95 | 13/500 | 20/500 | 11 | 0 | 22–48 | 41/538 |
| 6501–7000 | 500/500 | 93 | 96 | 34/500 | 46/500 | 25 | 0 | 29–48 | 41/622 |
| 7501–8000 | 500/500 | 84 | 58 | 1/500 | 1/500 | 1 | 0 | 18–48 | 48/606 |
| 8501–9000 | 500/500 | 98 | 103 | 19/500 | 44/500 | 12 | 0 | 27–48 | 36/625 |

Numerical gate: pass. Manual visual decision is separate and compares adjacent 6000→7000→8000→9000 frames.
Prefix: verified through 6000; artifact SHA-256 1fb5f81e128f7e6ecf60449349257df09ec2ce0fd1155d5d0c2784e3f59a8e2f.
Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.
No claim of adaptation, fitness improvement, or general survival benefit.
