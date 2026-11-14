# Gate-0 exploration record 2: cyclic competition on the slab, Amendment 2 (2026-10-24)

Written by the main session from the readout's Amendment 2 table, as A2.5 of `experiments/3d-rps/RULES.md` asks, when both kill forms had a
label. **An exploration, not a registered result:** the registered pilot ended GATE-0-STOP (`GATE0-RECORD.md`) and Amendment 1 read
EXPLORATION-NO-HORIZON for both kills (`GATE0-EXPLORATION.md`); nothing here may be cited as passing Gate 0 or as a result of the registered
programme, and a label licenses nothing (A2.6).

- **Labels (A2.4):** the removal kill (rung S0) **EXPLORATION-2-NO-CONFIRM**; the vacancy kill (rung V on S0) **EXPLORATION-2-PERSISTS**.
- **Horizon (A2.2), 256 x 256 x 4, spread 8, rate 0, 200,000 run steps:** all three controls (seeds 401, 402, 403) kept every label to the
  end (class CHURN, no sustained loss), so `T_ctl` is infinite and `h0` = 200,000. In the larger world the neutral drift that ended
  Amendment 1 did not end a run within 200,000 steps.
- **Confirmation (A2.3), spread 8, rate 64, 200,000 run steps:** the removal kill lost a label in all three jobs (class LOSS); the vacancy
  kill was class DC in two of three (seeds 401 and 402) and lost a label in the third (seed 403), so it persists by the rule's 2-of-3.
- **Operating point:** carried over from Amendment 1 unchanged (A2.1): `v_cal` = 8, `kappa_w` = 64 for both kill forms.
- **Spike:** SHA-256 `761ea02a49f23e19ef2212487464bc15170cbcff036c1e6c7ebc799006140cc7` (`experiments/3d-rps/gate0-spike`, 14 files, the
  recipe of 3.0, taken on the committed files before the first Amendment 2 job), run against the tree at commit `0b47eb47` (branch
  `claude/3d-cyclic-rps`).
- **Rules:** `RULES.md` SHA-256 `1bc36ffbf0f2e5f9b1314e7698480a5363c61a92365b694f951edcdb86ffa8ae` (the frozen rules with Amendments 1 and 2, recorded in `FROZEN` before the first Amendment 2
  job).
- **Host:** the work Mac (`EWS2400306`, Apple M3 Pro), a clone at `0b47eb47`; 9 job directories (3 horizon, 6 confirmation), each listed in
  the table below with its steps per second. The table was read again on a second machine from a copy of the directory and came out
  identical.

## The readout's Amendment 2 table (verbatim, `readout.ts gate0-exploration-2` on the work Mac)

EXPLORATION (Amendment 2): the registered pilot ended GATE-0-STOP

rules: RULES.md sha256 1bc36ffbf0f2e5f9b1314e7698480a5363c61a92365b694f951edcdb86ffa8ae is recorded in FROZEN, and it contains the Amendment 2 heading

## Persistence at 256 x 256 x 4 (RULES.md Amendment 2)

Not a registered result: nothing below may be cited as passing Gate 0 or as a result of the registered programme, and a label licenses nothing (A2.6).

Operating point carried over from Amendment 1 (A2.1): v_cal = 8, kappa_w = 64, for both kill forms; shape 256 x 256 x 4.

### Horizon (A2.2: G0.4 at 256 x 256 x 4, spread 8, rate 0, seeds 401, 402, 403)

| seed | class | first sustained loss (run step) |
|---|---|---|
| 401 | CHURN | inf |
| 402 | CHURN | inf |
| 403 | CHURN | inf |

T_ctl inf; h0 200000

### Removal kill (rung S0): EXPLORATION-2-NO-CONFIRM

A2.3 confirmation (spread 8, rate 64, 200000 run steps; seeds 401, 402, 403):

| classes | DC | persists (DC in at least 2 of 3) |
|---|---|---|
| LOSS LOSS LOSS | 0 | no |

### Vacancy kill (rung V on S0): EXPLORATION-2-PERSISTS

A2.3 confirmation (spread 8, rate 64, 200000 run steps; seeds 401, 402, 403):

| classes | DC | persists (DC in at least 2 of 3) |
|---|---|---|
| DC DC LOSS | 2 | yes |

### Labels (A2.4: one per kill form)

- Removal kill (rung S0): **EXPLORATION-2-NO-CONFIRM**
- Vacancy kill (rung V on S0): **EXPLORATION-2-PERSISTS**

### Amendment 2 jobs (A2.5)

| id | rung | kill | stage | shape | spread | rate | seed | steps | class | chi_fw | turnover | liv | steps/s | host |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| g2-confirm-S0-sp8-r64-s401 | S0 | removal | g0.confirm | 256x256x4 | 8 | 64 | 401 | 184000 | LOSS | 0.519 | - | 1 | 225.3 | EWS2400306 |
| g2-confirm-S0-sp8-r64-s402 | S0 | removal | g0.confirm | 256x256x4 | 8 | 64 | 402 | 90000 | LOSS | 0.458 | - | 1.000 | 226.9 | EWS2400306 |
| g2-confirm-S0-sp8-r64-s403 | S0 | removal | g0.confirm | 256x256x4 | 8 | 64 | 403 | 162000 | LOSS | 0.477 | - | 1 | 221.8 | EWS2400306 |
| g2-confirm-V-sp8-r64-s401 | V | vacancy | g0.confirm | 256x256x4 | 8 | 64 | 401 | 206000 | DC | 0.485 | 0.122 | 0.998 | 220.2 | EWS2400306 |
| g2-confirm-V-sp8-r64-s402 | V | vacancy | g0.confirm | 256x256x4 | 8 | 64 | 402 | 206000 | DC | 0.419 | 0.127 | 0.998 | 220.6 | EWS2400306 |
| g2-confirm-V-sp8-r64-s403 | V | vacancy | g0.confirm | 256x256x4 | 8 | 64 | 403 | 134000 | LOSS | 0.504 | - | 0.999 | 216.5 | EWS2400306 |
| g2-horizon-S0-sp8-r0-s401 | S0 | removal | g0.horizon-rung | 256x256x4 | 8 | 0 | 401 | 206000 | CHURN | 0.007 | 0.330 | 1 | 211.7 | EWS2400306 |
| g2-horizon-S0-sp8-r0-s402 | S0 | removal | g0.horizon-rung | 256x256x4 | 8 | 0 | 402 | 206000 | CHURN | 0.000 | 0.493 | 1 | 212.8 | EWS2400306 |
| g2-horizon-S0-sp8-r0-s403 | S0 | removal | g0.horizon-rung | 256x256x4 | 8 | 0 | 403 | 206000 | CHURN | 0.002 | 0.435 | 1 | 220.6 | EWS2400306 |

exit code 0: both kill forms have a label of A2.4 (an exploration, not a registered result)
