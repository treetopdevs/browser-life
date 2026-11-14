# Gate-0 exploration record: cyclic competition on the slab, Amendment 1 (2026-10-24)

Written by the main session from the readout's exploration table, as A1.5 of `experiments/3d-rps/RULES.md` asks, when both rungs had a
label. **An exploration, not a registered result:** the registered pilot ended GATE-0-STOP (`GATE0-RECORD.md`); nothing here may be cited
as passing Gate 0 or as a result of the registered programme, and a label licenses nothing (A1.6).

- **Labels (A1.4):** rung S0 (the removal kill) **EXPLORATION-NO-HORIZON** (row 3); rung V (the vacancy kill on S0)
  **EXPLORATION-NO-HORIZON** (row 3).
- **Row 2 (the kill's effect), both rungs passed it:** the removal kill worked at rate 64 at all three spreads (DC in 2, 3 and 2 of 3
  jobs at spreads 6, 8 and 16); the vacancy kill worked at rates 64 and 256 at all three spreads and at 4096 at spreads 6 and 16.
  `kappa_w` = 64 and `v_cal` = 8 for both. The rate-0 controls were informative at every spread (all labels kept, median `|chi_fw|` 0.002
  to 0.007).
- **Row 3 (the horizon), both rungs failed it:** the shared G0.4 controls (spread 8, rate 0, 200,000 steps) had their first sustained
  loss at run steps 177,000 and 101,000 (seeds 401 and 402) and none on seed 403, so `T_ctl` = 177,000 and `T_ctl / 4` = 44,250 is below
  50,000: `h0` is none. G0.5 (the confirmation) therefore did not run for either rung.
- **V check (G0.1):** the vacancy build's rate-0 job at spread 8, seed 401 reproduced the registered removal scan's `census.tsv` byte for
  byte.
- **Spike:** SHA-256 `39f5d7688c54d84e79059169d7553122929d3613fdf3412fa9975daae6ec58e5` (`experiments/3d-rps/gate0-spike`, 14 files, the
  recipe of 3.0, taken on the committed files before the exploration's first job), run against the tree at commit `a5d47711` (branch
  `claude/3d-cyclic-rps`).
- **Rules:** `RULES.md` SHA-256 `6953da7d4532c5de299b61c434ffe630ed1622a83496a85580327060a279a870` (the frozen rules with Amendment 1, recorded in `FROZEN` before the first exploration job).
- **Host:** the work Mac (`EWS2400306`, Apple M3 Pro), a clone at `a5d47711`; 82 exploration job directories (79 of the first wave and
  the 3 horizon jobs), each listed in the table below with its steps per second; the table also lists the 3 registered rate-0 seed-401
  scan jobs it reuses (85 rows). The registered S0 scan and meter jobs were read from the registered pilot's directory and not rerun. The table was read again on a second machine from a copy of both directories and came out
  identical.

## The readout's exploration table (verbatim, `readout.ts gate0-exploration` on the work Mac)

EXPLORATION (Amendment 1): the registered pilot ended GATE-0-STOP

rules: RULES.md sha256 6953da7d4532c5de299b61c434ffe630ed1622a83496a85580327060a279a870 is recorded in FROZEN, and it contains the Amendment 1 heading

## Exploration of the kill at S0's four mobility levels (RULES.md Amendment 1)

Not a registered result: nothing below may be cited as passing Gate 0 or as a result of the registered programme, and a label licenses nothing (A1.6).

### Registered G0.2 of S0 (reused, not rerun: A1.1)

| spread | class | carpet | min liv | B+P/cell | D_lab | flags | in G_spread |
|---|---|---|---|---|---|---|---|
| 2 | NOSTART | no | - | - | - | - | no |
| 3 | NOSTART | no | - | - | - | - | no |
| 4 | CHURN | no | 0.311 | 94.4 | - | - | no |
| 6 | CHURN | yes | 1 | 28.2 | 0.00e+0 | flat | yes |
| 8 | CHURN | yes | 1 | 28.3 | 1.57e-2 | anisotropic | yes |
| 10 | CHURN | yes | 1 | 28.1 | 2.90e-2 | - | yes |
| 12 | CHURN | yes | 1 | 27.3 | 2.90e-2 | - | no |
| 16 | CHURN | yes | 1 | 27.8 | 4.39e-2 | - | yes |
| 20 | CHURN | yes | 1 | 27.9 | 2.90e-2 | - | no |
| 24 | CHURN | yes | 1 | 28.0 | 2.90e-2 | - | no |
| 28 | CHURN | yes | 1 | 28.2 | 2.90e-2 | - | no |
| 32 | NOSTART | no | - | - | - | - | no |

B_meter = 28; G_spread = [6, 8, 10, 16]; levels = 4 (row 1 for this exploration: levels < 4 fails, A1.1)

v_lo, v_mid, v_hi = 6, 8, 16 (A1.2)

### Rung S0 (removal kill): EXPLORATION-NO-HORIZON (row 3)

G0.3 table (rates 0, 8, 16, 32, 64; classes of seeds 401, 402, 403; the rate-0 cells are S0's, their seed 401 the registered scan job):

| spread | rate | classes | DC | works |
|---|---|---|---|---|
| 6 | 0 | CHURN CHURN CHURN | 0 | (control) |
| 6 | 8 | CHURN CHURN CHURN | 0 | no |
| 6 | 16 | CHURN CHURN CHURN | 0 | no |
| 6 | 32 | CHURN CHURN CHURN | 0 | no |
| 6 | 64 | DC DC CHURN | 2 | yes |
| 8 | 0 | CHURN CHURN CHURN | 0 | (control) |
| 8 | 8 | CHURN CHURN CHURN | 0 | no |
| 8 | 16 | CHURN CHURN CHURN | 0 | no |
| 8 | 32 | CHURN LATE CHURN | 0 | no |
| 8 | 64 | DC DC DC | 3 | yes |
| 16 | 0 | CHURN CHURN CHURN | 0 | (control) |
| 16 | 8 | CHURN CHURN CHURN | 0 | no |
| 16 | 16 | CHURN LOSS LATE | 0 | no |
| 16 | 32 | LOSS CHURN LOSS | 0 | no |
| 16 | 64 | DC DC LOSS | 2 | yes |

kappa_w = 64; v_cal = 8

G0.4 horizon (shared; spread 8, rate 0, shape 128x128x4): classes LOSS LOSS CHURN; first sustained loss (run step) 177000, 101000, inf; T_ctl 177000; h0 none (row 3: EXPLORATION-NO-HORIZON)

### Rung V (vacancy kill on S0): EXPLORATION-NO-HORIZON (row 3)

G0.3 table (rates 0, 64, 256, 1024, 4096; classes of seeds 401, 402, 403; the rate-0 cells are S0's, their seed 401 the registered scan job):

| spread | rate | classes | DC | works |
|---|---|---|---|---|
| 6 | 0 | CHURN CHURN CHURN | 0 | (control) |
| 6 | 64 | DC DC DC | 3 | yes |
| 6 | 256 | DC DC DC | 3 | yes |
| 6 | 1024 | LOSS LOSS LOSS | 0 | no |
| 6 | 4096 | DC DC LOSS | 2 | yes |
| 8 | 0 | CHURN CHURN CHURN | 0 | (control) |
| 8 | 64 | DC LATE DC | 2 | yes |
| 8 | 256 | DC LOSS DC | 2 | yes |
| 8 | 1024 | DC LOSS LOSS | 1 | no |
| 8 | 4096 | LOSS LOSS LATE | 0 | no |
| 16 | 0 | CHURN CHURN CHURN | 0 | (control) |
| 16 | 64 | DC DC LOSS | 2 | yes |
| 16 | 256 | DC DC LOSS | 2 | yes |
| 16 | 1024 | LOSS DC LOSS | 1 | no |
| 16 | 4096 | DC DC DC | 3 | yes |

kappa_w = 64; v_cal = 8

G0.4 horizon (shared; spread 8, rate 0, shape 128x128x4): classes LOSS LOSS CHURN; first sustained loss (run step) 177000, 101000, inf; T_ctl 177000; h0 none (row 3: EXPLORATION-NO-HORIZON)

rate-0 controls of both rungs (informative: >= 2 finished, >= 2 keep every label, median |chi_fw| <= 0.1):

| spread | finished | keep labels | median |chi_fw| | informative |
|---|---|---|---|---|
| 6 | 3 | 3 | 0.005 | yes |
| 8 | 3 | 3 | 0.002 | yes |
| 16 | 3 | 3 | 0.007 | yes |

### V check (G0.1, A1.2)

identical: g0-vcheck-vacancy-S0-sp8-r0-s401 and the registered g0-scan-S0-sp8-r0-s401: census.tsv identical byte for byte

### Labels (A1.4: one per rung, both rungs evaluated in full; no rung is used)

- Rung S0 (removal kill): **EXPLORATION-NO-HORIZON (row 3)**
- Rung V (vacancy kill on S0): **EXPLORATION-NO-HORIZON (row 3)**

### Exploration jobs (A1.5; the registered rows are the table's rate-0 seed-401 cells)

| id | source | rung | kill | stage | spread | rate | seed | steps | class | chi_fw | turnover | liv | steps/s | host |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| g0-scan-S0-sp6-r0-s401 | registered | S0 | removal | g0.scan | 6 | 0 | 401 | 26000 | CHURN | -0.011 | 0.436 | 1 | 1241.3 | EWS2400306 |
| g0-scan-S0-sp8-r0-s401 | registered | S0 | removal | g0.scan | 8 | 0 | 401 | 26000 | CHURN | -0.002 | 0.544 | 1 | 1257.7 | EWS2400306 |
| g0-scan-S0-sp16-r0-s401 | registered | S0 | removal | g0.scan | 16 | 0 | 401 | 26000 | CHURN | 0.012 | 0.578 | 1 | 1127.8 | EWS2400306 |
| g0-horizon-S0-sp8-r0-s401 | exploration | S0 | removal | g0.horizon | 8 | 0 | 401 | 185000 | LOSS | -0.008 | - | 1 | 594.9 | EWS2400306 |
| g0-horizon-S0-sp8-r0-s402 | exploration | S0 | removal | g0.horizon | 8 | 0 | 402 | 109000 | LOSS | 0.017 | - | 1 | 596.6 | EWS2400306 |
| g0-horizon-S0-sp8-r0-s403 | exploration | S0 | removal | g0.horizon | 8 | 0 | 403 | 206000 | CHURN | 0.008 | 0.409 | 1 | 592.9 | EWS2400306 |
| g0-table-S0-sp16-r0-s402 | exploration | S0 | removal | g0.table | 16 | 0 | 402 | 26000 | CHURN | -0.004 | 0.591 | 1 | 573.8 | EWS2400306 |
| g0-table-S0-sp16-r0-s403 | exploration | S0 | removal | g0.table | 16 | 0 | 403 | 26000 | CHURN | -0.007 | 0.576 | 1 | 550.6 | EWS2400306 |
| g0-table-S0-sp16-r16-s401 | exploration | S0 | removal | g0.table | 16 | 16 | 401 | 26000 | CHURN | 0.092 | 0.473 | 1 | 528.9 | EWS2400306 |
| g0-table-S0-sp16-r16-s402 | exploration | S0 | removal | g0.table | 16 | 16 | 402 | 24000 | LOSS | 0 | - | 1 | 568.7 | EWS2400306 |
| g0-table-S0-sp16-r16-s403 | exploration | S0 | removal | g0.table | 16 | 16 | 403 | 26000 | LATE | 0.061 | 0.497 | 1 | 602.7 | EWS2400306 |
| g0-table-S0-sp16-r32-s401 | exploration | S0 | removal | g0.table | 16 | 32 | 401 | 25000 | LOSS | 0 | - | 1 | 593.4 | EWS2400306 |
| g0-table-S0-sp16-r32-s402 | exploration | S0 | removal | g0.table | 16 | 32 | 402 | 26000 | CHURN | 0.174 | 0.429 | 1 | 579.1 | EWS2400306 |
| g0-table-S0-sp16-r32-s403 | exploration | S0 | removal | g0.table | 16 | 32 | 403 | 25000 | LOSS | 0 | - | 1 | 572.8 | EWS2400306 |
| g0-table-S0-sp16-r64-s401 | exploration | S0 | removal | g0.table | 16 | 64 | 401 | 26000 | DC | 0.336 | 0.384 | 1 | 569.2 | EWS2400306 |
| g0-table-S0-sp16-r64-s402 | exploration | S0 | removal | g0.table | 16 | 64 | 402 | 26000 | DC | 0.347 | 0.385 | 1 | 551.4 | EWS2400306 |
| g0-table-S0-sp16-r64-s403 | exploration | S0 | removal | g0.table | 16 | 64 | 403 | 14000 | LOSS | 0 | - | 1 | 549.8 | EWS2400306 |
| g0-table-S0-sp16-r8-s401 | exploration | S0 | removal | g0.table | 16 | 8 | 401 | 26000 | CHURN | 0.046 | 0.486 | 1 | 527.4 | EWS2400306 |
| g0-table-S0-sp16-r8-s402 | exploration | S0 | removal | g0.table | 16 | 8 | 402 | 26000 | CHURN | 0.024 | 0.554 | 1 | 521.9 | EWS2400306 |
| g0-table-S0-sp16-r8-s403 | exploration | S0 | removal | g0.table | 16 | 8 | 403 | 26000 | CHURN | 0.024 | 0.551 | 1 | 521.8 | EWS2400306 |
| g0-table-S0-sp6-r0-s402 | exploration | S0 | removal | g0.table | 6 | 0 | 402 | 26000 | CHURN | 0.004 | 0.465 | 1 | 606.7 | EWS2400306 |
| g0-table-S0-sp6-r0-s403 | exploration | S0 | removal | g0.table | 6 | 0 | 403 | 26000 | CHURN | -0.005 | 0.445 | 1 | 598.9 | EWS2400306 |
| g0-table-S0-sp6-r16-s401 | exploration | S0 | removal | g0.table | 6 | 16 | 401 | 26000 | CHURN | 0.078 | 0.401 | 1 | 550.4 | EWS2400306 |
| g0-table-S0-sp6-r16-s402 | exploration | S0 | removal | g0.table | 6 | 16 | 402 | 26000 | CHURN | 0.085 | 0.380 | 1 | 581.8 | EWS2400306 |
| g0-table-S0-sp6-r16-s403 | exploration | S0 | removal | g0.table | 6 | 16 | 403 | 26000 | CHURN | 0.068 | 0.442 | 1 | 594.9 | EWS2400306 |
| g0-table-S0-sp6-r32-s401 | exploration | S0 | removal | g0.table | 6 | 32 | 401 | 26000 | CHURN | 0.169 | 0.084 | 0.534 | 603.5 | EWS2400306 |
| g0-table-S0-sp6-r32-s402 | exploration | S0 | removal | g0.table | 6 | 32 | 402 | 26000 | CHURN | 0.141 | 0.083 | 0.539 | 572.3 | EWS2400306 |
| g0-table-S0-sp6-r32-s403 | exploration | S0 | removal | g0.table | 6 | 32 | 403 | 26000 | CHURN | 0.148 | 0.085 | 0.551 | 563.9 | EWS2400306 |
| g0-table-S0-sp6-r64-s401 | exploration | S0 | removal | g0.table | 6 | 64 | 401 | 26000 | DC | 0.219 | 0.062 | 0.541 | 558.7 | EWS2400306 |
| g0-table-S0-sp6-r64-s402 | exploration | S0 | removal | g0.table | 6 | 64 | 402 | 26000 | DC | 0.233 | 0.057 | 0.525 | 557 | EWS2400306 |
| g0-table-S0-sp6-r64-s403 | exploration | S0 | removal | g0.table | 6 | 64 | 403 | 26000 | CHURN | 0.200 | 0.067 | 0.532 | 583.3 | EWS2400306 |
| g0-table-S0-sp6-r8-s401 | exploration | S0 | removal | g0.table | 6 | 8 | 401 | 26000 | CHURN | 0.040 | 0.435 | 1 | 575 | EWS2400306 |
| g0-table-S0-sp6-r8-s402 | exploration | S0 | removal | g0.table | 6 | 8 | 402 | 26000 | CHURN | 0.025 | 0.421 | 1 | 562.6 | EWS2400306 |
| g0-table-S0-sp6-r8-s403 | exploration | S0 | removal | g0.table | 6 | 8 | 403 | 26000 | CHURN | 0.022 | 0.461 | 1 | 552.6 | EWS2400306 |
| g0-table-S0-sp8-r0-s402 | exploration | S0 | removal | g0.table | 8 | 0 | 402 | 26000 | CHURN | -0.002 | 0.509 | 1 | 634.9 | EWS2400306 |
| g0-table-S0-sp8-r0-s403 | exploration | S0 | removal | g0.table | 8 | 0 | 403 | 26000 | CHURN | -0.009 | 0.459 | 1 | 611.2 | EWS2400306 |
| g0-table-S0-sp8-r16-s401 | exploration | S0 | removal | g0.table | 8 | 16 | 401 | 26000 | CHURN | 0.054 | 0.469 | 1 | 558.7 | EWS2400306 |
| g0-table-S0-sp8-r16-s402 | exploration | S0 | removal | g0.table | 8 | 16 | 402 | 26000 | CHURN | 0.068 | 0.410 | 1 | 598 | EWS2400306 |
| g0-table-S0-sp8-r16-s403 | exploration | S0 | removal | g0.table | 8 | 16 | 403 | 26000 | CHURN | 0.048 | 0.454 | 1 | 610.6 | EWS2400306 |
| g0-table-S0-sp8-r32-s401 | exploration | S0 | removal | g0.table | 8 | 32 | 401 | 26000 | CHURN | 0.143 | 0.425 | 1 | 605.9 | EWS2400306 |
| g0-table-S0-sp8-r32-s402 | exploration | S0 | removal | g0.table | 8 | 32 | 402 | 26000 | LATE | 0.204 | 0.304 | 1 | 585.9 | EWS2400306 |
| g0-table-S0-sp8-r32-s403 | exploration | S0 | removal | g0.table | 8 | 32 | 403 | 26000 | CHURN | 0.119 | 0.418 | 1 | 565.3 | EWS2400306 |
| g0-table-S0-sp8-r64-s401 | exploration | S0 | removal | g0.table | 8 | 64 | 401 | 26000 | DC | 0.312 | 0.350 | 0.993 | 563.3 | EWS2400306 |
| g0-table-S0-sp8-r64-s402 | exploration | S0 | removal | g0.table | 8 | 64 | 402 | 26000 | DC | 0.369 | 0.272 | 1 | 553.9 | EWS2400306 |
| g0-table-S0-sp8-r64-s403 | exploration | S0 | removal | g0.table | 8 | 64 | 403 | 26000 | DC | 0.371 | 0.288 | 0.993 | 591.8 | EWS2400306 |
| g0-table-S0-sp8-r8-s401 | exploration | S0 | removal | g0.table | 8 | 8 | 401 | 26000 | CHURN | 0.020 | 0.482 | 1 | 598.8 | EWS2400306 |
| g0-table-S0-sp8-r8-s402 | exploration | S0 | removal | g0.table | 8 | 8 | 402 | 26000 | CHURN | 0.032 | 0.446 | 1 | 588.2 | EWS2400306 |
| g0-table-S0-sp8-r8-s403 | exploration | S0 | removal | g0.table | 8 | 8 | 403 | 26000 | CHURN | 0.037 | 0.448 | 1 | 582.1 | EWS2400306 |
| g0-table-V-sp16-r1024-s401 | exploration | V | vacancy | g0.table | 16 | 1024 | 401 | 22000 | LOSS | 0 | - | 0.993 | 616.6 | EWS2400306 |
| g0-table-V-sp16-r1024-s402 | exploration | V | vacancy | g0.table | 16 | 1024 | 402 | 26000 | DC | 0.876 | 0.260 | 0.976 | 594.9 | EWS2400306 |
| g0-table-V-sp16-r1024-s403 | exploration | V | vacancy | g0.table | 16 | 1024 | 403 | 19000 | LOSS | 0 | - | 0.992 | 576.9 | EWS2400306 |
| g0-table-V-sp16-r256-s401 | exploration | V | vacancy | g0.table | 16 | 256 | 401 | 26000 | DC | 0.895 | 0.360 | 0.991 | 585.2 | EWS2400306 |
| g0-table-V-sp16-r256-s402 | exploration | V | vacancy | g0.table | 16 | 256 | 402 | 26000 | DC | 0.889 | 0.359 | 0.991 | 581.4 | EWS2400306 |
| g0-table-V-sp16-r256-s403 | exploration | V | vacancy | g0.table | 16 | 256 | 403 | 14000 | LOSS | 0 | - | 0.997 | 589 | EWS2400306 |
| g0-table-V-sp16-r4096-s401 | exploration | V | vacancy | g0.table | 16 | 4096 | 401 | 26000 | DC | 0.975 | 0.295 | 0.970 | 588.5 | EWS2400306 |
| g0-table-V-sp16-r4096-s402 | exploration | V | vacancy | g0.table | 16 | 4096 | 402 | 26000 | DC | 0.966 | 0.288 | 0.972 | 593.8 | EWS2400306 |
| g0-table-V-sp16-r4096-s403 | exploration | V | vacancy | g0.table | 16 | 4096 | 403 | 26000 | DC | 0.971 | 0.298 | 0.965 | 593.1 | EWS2400306 |
| g0-table-V-sp16-r64-s401 | exploration | V | vacancy | g0.table | 16 | 64 | 401 | 26000 | DC | 0.366 | 0.356 | 1.000 | 575.4 | EWS2400306 |
| g0-table-V-sp16-r64-s402 | exploration | V | vacancy | g0.table | 16 | 64 | 402 | 26000 | DC | 0.308 | 0.396 | 1.000 | 572.3 | EWS2400306 |
| g0-table-V-sp16-r64-s403 | exploration | V | vacancy | g0.table | 16 | 64 | 403 | 18000 | LOSS | 0 | - | 1.000 | 571.4 | EWS2400306 |
| g0-table-V-sp6-r1024-s401 | exploration | V | vacancy | g0.table | 6 | 1024 | 401 | 26000 | LOSS | 0.891 | - | 0.788 | 557.6 | EWS2400306 |
| g0-table-V-sp6-r1024-s402 | exploration | V | vacancy | g0.table | 6 | 1024 | 402 | 21000 | LOSS | 0 | - | 0.812 | 618.5 | EWS2400306 |
| g0-table-V-sp6-r1024-s403 | exploration | V | vacancy | g0.table | 6 | 1024 | 403 | 17000 | LOSS | 0 | - | 0.939 | 600.6 | EWS2400306 |
| g0-table-V-sp6-r256-s401 | exploration | V | vacancy | g0.table | 6 | 256 | 401 | 26000 | DC | 0.616 | 0.122 | 0.638 | 575.2 | EWS2400306 |
| g0-table-V-sp6-r256-s402 | exploration | V | vacancy | g0.table | 6 | 256 | 402 | 26000 | DC | 0.618 | 0.121 | 0.633 | 562.3 | EWS2400306 |
| g0-table-V-sp6-r256-s403 | exploration | V | vacancy | g0.table | 6 | 256 | 403 | 26000 | DC | 0.612 | 0.137 | 0.623 | 550.3 | EWS2400306 |
| g0-table-V-sp6-r4096-s401 | exploration | V | vacancy | g0.table | 6 | 4096 | 401 | 26000 | DC | 0.930 | 0.451 | 0.841 | 581.5 | EWS2400306 |
| g0-table-V-sp6-r4096-s402 | exploration | V | vacancy | g0.table | 6 | 4096 | 402 | 26000 | DC | 0.913 | 0.414 | 0.890 | 547.3 | EWS2400306 |
| g0-table-V-sp6-r4096-s403 | exploration | V | vacancy | g0.table | 6 | 4096 | 403 | 15000 | LOSS | 0 | - | 0.917 | 537.1 | EWS2400306 |
| g0-table-V-sp6-r64-s401 | exploration | V | vacancy | g0.table | 6 | 64 | 401 | 26000 | DC | 0.254 | 0.066 | 0.551 | 620.6 | EWS2400306 |
| g0-table-V-sp6-r64-s402 | exploration | V | vacancy | g0.table | 6 | 64 | 402 | 26000 | DC | 0.258 | 0.069 | 0.530 | 607.1 | EWS2400306 |
| g0-table-V-sp6-r64-s403 | exploration | V | vacancy | g0.table | 6 | 64 | 403 | 26000 | DC | 0.232 | 0.075 | 0.540 | 586.1 | EWS2400306 |
| g0-table-V-sp8-r1024-s401 | exploration | V | vacancy | g0.table | 8 | 1024 | 401 | 26000 | DC | 0.881 | 0.421 | 0.863 | 593.2 | EWS2400306 |
| g0-table-V-sp8-r1024-s402 | exploration | V | vacancy | g0.table | 8 | 1024 | 402 | 13000 | LOSS | 0 | - | 0.919 | 585 | EWS2400306 |
| g0-table-V-sp8-r1024-s403 | exploration | V | vacancy | g0.table | 8 | 1024 | 403 | 18000 | LOSS | 0 | - | 0.954 | 588.7 | EWS2400306 |
| g0-table-V-sp8-r256-s401 | exploration | V | vacancy | g0.table | 8 | 256 | 401 | 26000 | DC | 0.677 | 0.217 | 0.856 | 643.4 | EWS2400306 |
| g0-table-V-sp8-r256-s402 | exploration | V | vacancy | g0.table | 8 | 256 | 402 | 26000 | LOSS | 0.813 | - | 0.908 | 620 | EWS2400306 |
| g0-table-V-sp8-r256-s403 | exploration | V | vacancy | g0.table | 8 | 256 | 403 | 26000 | DC | 0.745 | 0.230 | 0.892 | 607.2 | EWS2400306 |
| g0-table-V-sp8-r4096-s401 | exploration | V | vacancy | g0.table | 8 | 4096 | 401 | 22000 | LOSS | 0 | - | 0.986 | 578.4 | EWS2400306 |
| g0-table-V-sp8-r4096-s402 | exploration | V | vacancy | g0.table | 8 | 4096 | 402 | 12000 | LOSS | 0 | - | 1 | 627.1 | EWS2400306 |
| g0-table-V-sp8-r4096-s403 | exploration | V | vacancy | g0.table | 8 | 4096 | 403 | 26000 | LATE | 0.934 | 0.454 | 0.978 | 628.3 | EWS2400306 |
| g0-table-V-sp8-r64-s401 | exploration | V | vacancy | g0.table | 8 | 64 | 401 | 26000 | DC | 0.328 | 0.326 | 0.996 | 548.2 | EWS2400306 |
| g0-table-V-sp8-r64-s402 | exploration | V | vacancy | g0.table | 8 | 64 | 402 | 26000 | LATE | 0.408 | 0.284 | 0.998 | 547.3 | EWS2400306 |
| g0-table-V-sp8-r64-s403 | exploration | V | vacancy | g0.table | 8 | 64 | 403 | 26000 | DC | 0.377 | 0.260 | 0.999 | 566.4 | EWS2400306 |
| g0-vcheck-vacancy-S0-sp8-r0-s401 | exploration | V | vacancy | g0.vcheck | 8 | 0 | 401 | 26000 | - | - | - | - | 577.2 | EWS2400306 |

exit code 0: both rungs have a label of A1.4 (an exploration, not a registered result)
