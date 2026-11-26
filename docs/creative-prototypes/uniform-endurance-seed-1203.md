# Uniform food endurance screen

Seed 1203; Node 24.2.0 on darwin/arm64.
Uniform food, mutation enabled; stopped at 9000.
Descriptive engineered-rule longevity screen. This does not test adaptation or compare a rerun original/patches arm.

| Window | Executed | Births | Deaths | Cap 48 | Near cap 47+ | Cap blocked | Space blocked | Population min–max | Endpoint population/cells |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 5501–6000 | 500/500 | 84 | 74 | 0/500 | 0/500 | 0 | 0 | 20–37 | 37/486 |
| 6501–7000 | 500/500 | 93 | 100 | 28/500 | 41/500 | 19 | 0 | 28–48 | 34/566 |
| 7501–8000 | 500/500 | 85 | 70 | 0/500 | 0/500 | 0 | 0 | 20–39 | 38/498 |
| 8501–9000 | 500/500 | 84 | 88 | 32/500 | 61/500 | 41 | 0 | 30–48 | 42/824 |

Numerical gate: pass. Manual visual decision is separate and compares adjacent 6000→7000→8000→9000 frames.
Prefix: verified through 6000; artifact SHA-256 8c3ac66e4d3699e423a58597411c05b187dc56fdf9dab7b2550296da2fc95b33.
Frames are every 20 actual ticks plus any off-cadence terminal tick. Post-extinction ticks are zero-occupancy window slots, not simulated observations.
No claim of adaptation, fitness improvement, or general survival benefit.
