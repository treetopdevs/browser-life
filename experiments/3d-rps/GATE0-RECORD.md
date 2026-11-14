# Gate-0 record: cyclic competition on the slab (2026-10-24)

Written by the main session from the readout's Gate-0 table, as rule 8.5 of `experiments/3d-rps/RULES.md` asks, at the final verdict.
Gate-0 numbers are pilot numbers: no write-up quotes one as a result.

- **Verdict: GATE-0-STOP** (rule 3.0). Every substrate rung ended **NO-GO: LEVELS** (verdict row 1, `levels < 5`):
  - S0: `G_spread` = [6, 8, 10, 16], levels 4.
  - S1: `G_spread` = [4, 10], levels 2.
  - S2: `G_spread` = [2, 4, 8, 20], levels 4. S2 ran because S0 and S1 both ended at row 1 (D2).
- **Rung V: not run.** It needs a substrate rung that passes row 1 (G0.1), and none did. **V check: not run** (no V job).
- **Horizon rung: not applicable** (it is tried only when every rung that passed rows 1 and 2 failed at row 3; no rung reached row 2).
- **Operating point: not applicable** (GATE-0-STOP): no rung, kill form, `G_spread`, `v_cal`, `kappa_w`, `R_cal` or `h0` is set; the
  registered kernel shape stays 128 x 128 x 4 and was the shape of every job. **Dense rate (G0.6): not applicable.**
- **Spike:** SHA-256 `bf9fc20ea93b79cf4ab604b2861c50cde7b0387eee7cfa87e66d3098b6132414` (`experiments/3d-rps/gate0-spike`, 13 files,
  the recipe of 3.0, taken on the committed files before the first Gate-0 job), run against the tree at commit `7fabcd8e` (branch
  `claude/3d-cyclic-rps`).
- **`census-rps.ts`:** git blob `bd45708b45cf65a7cafe5827dda180fa242e411b` at `7fabcd8e`.
- **Rules:** `RULES.md` SHA-256 `f51170c605e40abfc1ab5e4ae1fcd2eef3088c61eb2b6fb1df29019d0d54d4d0`, frozen 2026-10-24 before the first Gate-0 job.
- **Host:** the work Mac (`EWS2400306`, Apple M3 Pro), a clone at `7fabcd8e`; 108 job directories, every one listed in the table below
  with its steps per second. The table was read again on a second machine from a copy of the job files and came out identical.
- **What the rules say next:** no further rung is pre-registered; the main session decides by dated amendment (8.3), and the options
  are listed under "If no rung gives GO" in 3.0.

## The readout's Gate-0 table (verbatim, `gate0.ts --table` on the frozen rules)

rules: RULES.md sha256 f51170c605e40abfc1ab5e4ae1fcd2eef3088c61eb2b6fb1df29019d0d54d4d0 is recorded in FROZEN

## Gate 0 (rules 3.0)

### Rung S0: NO-GO: LEVELS (row 1)

listed: g0-scan-S0-sp2-r0-s401 is NOSTART; g0-scan-S0-sp3-r0-s401 is NOSTART; g0-scan-S0-sp32-r0-s401 is NOSTART

G0.2 control scan (rate 0, seed 401) and meter:

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

B_meter = 28; G_spread = [6, 8, 10, 16]; levels = 4 (row 1: levels < 5 is NO-GO: LEVELS)

### Rung S1: NO-GO: LEVELS (row 1)

listed: g0-scan-S1-sp2-r0-s401 is NOSTART; g0-scan-S1-sp3-r0-s401 is NOSTART

G0.2 control scan (rate 0, seed 401) and meter:

| spread | class | carpet | min liv | B+P/cell | D_lab | flags | in G_spread |
|---|---|---|---|---|---|---|---|
| 2 | NOSTART | no | - | - | - | - | no |
| 3 | NOSTART | no | - | - | - | - | no |
| 4 | CHURN | yes | 1 | 113.7 | 3.54e-2 | - | yes |
| 6 | CHURN | yes | 1 | 113.1 | 4.11e-2 | - | no |
| 8 | CHURN | yes | 1 | 114.2 | 4.32e-2 | - | no |
| 10 | CHURN | yes | 1 | 114.2 | 5.98e-2 | - | yes |
| 12 | CHURN | yes | 1 | 113.3 | 5.47e-2 | - | no |
| 16 | CHURN | yes | 1 | 113.3 | 5.89e-2 | - | no |
| 20 | CHURN | yes | 1 | 113.1 | 7.04e-2 | - | no |
| 24 | CHURN | yes | 1 | 113.4 | 7.09e-2 | - | no |
| 28 | CHURN | yes | 1 | 113.2 | 7.49e-2 | - | no |
| 32 | CHURN | yes | 1 | 113.7 | 7.18e-2 | - | no |

B_meter = 113; G_spread = [4, 10]; levels = 2 (row 1: levels < 5 is NO-GO: LEVELS)

### Rung S2: NO-GO: LEVELS (row 1)

G0.2 control scan (rate 0, seed 401) and meter:

| spread | class | carpet | min liv | B+P/cell | D_lab | flags | in G_spread |
|---|---|---|---|---|---|---|---|
| 2 | CHURN | yes | 0.711 | 316.0 | 2.19e-2 | - | yes |
| 3 | CHURN | yes | 0.737 | 298.1 | 2.58e-2 | - | no |
| 4 | CHURN | yes | 1 | 226.2 | 3.34e-2 | - | yes |
| 6 | CHURN | yes | 1 | 226.1 | 4.15e-2 | - | no |
| 8 | CHURN | yes | 1 | 226.0 | 5.55e-2 | - | yes |
| 10 | CHURN | yes | 1 | 225.7 | 6.39e-2 | - | no |
| 12 | CHURN | yes | 1 | 225.9 | 6.33e-2 | - | no |
| 16 | CHURN | yes | 1 | 226.0 | 5.83e-2 | - | no |
| 20 | CHURN | yes | 1 | 226.2 | 7.24e-2 | - | yes |
| 24 | CHURN | yes | 1 | 226.0 | 5.92e-2 | - | no |
| 28 | LATE | yes | 1 | 226.0 | 6.47e-2 | - | no |
| 32 | CHURN | yes | 1 | 226.3 | 6.60e-2 | - | no |

B_meter = 226; G_spread = [2, 4, 8, 20]; levels = 4 (row 1: levels < 5 is NO-GO: LEVELS)

### V check (G0.1)

absent: no g0.vcheck job

### Verdict

**GATE-0-STOP**

### Gate-0 jobs (8.5)

| id | rung | kill | stage | spread | rate | seed | steps | class | chi_fw | turnover | liv | steps/s | host |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| g0-meter-S0-sp10-r0-s405-x | S0 | removal | g0.meter | 10 | 0 | 405 | 5000 | - | - | - | - | 1384.4 | EWS2400306 |
| g0-meter-S0-sp10-r0-s405-y | S0 | removal | g0.meter | 10 | 0 | 405 | 5000 | - | - | - | - | 1386.1 | EWS2400306 |
| g0-meter-S0-sp12-r0-s405-x | S0 | removal | g0.meter | 12 | 0 | 405 | 5000 | - | - | - | - | 1417.6 | EWS2400306 |
| g0-meter-S0-sp12-r0-s405-y | S0 | removal | g0.meter | 12 | 0 | 405 | 5000 | - | - | - | - | 1414.3 | EWS2400306 |
| g0-meter-S0-sp16-r0-s405-x | S0 | removal | g0.meter | 16 | 0 | 405 | 5000 | - | - | - | - | 1401.3 | EWS2400306 |
| g0-meter-S0-sp16-r0-s405-y | S0 | removal | g0.meter | 16 | 0 | 405 | 5000 | - | - | - | - | 1350 | EWS2400306 |
| g0-meter-S0-sp2-r0-s405-x | S0 | removal | g0.meter | 2 | 0 | 405 | 5000 | - | - | - | - | 1577 | EWS2400306 |
| g0-meter-S0-sp2-r0-s405-y | S0 | removal | g0.meter | 2 | 0 | 405 | 5000 | - | - | - | - | 1577.4 | EWS2400306 |
| g0-meter-S0-sp20-r0-s405-x | S0 | removal | g0.meter | 20 | 0 | 405 | 5000 | - | - | - | - | 1416.9 | EWS2400306 |
| g0-meter-S0-sp20-r0-s405-y | S0 | removal | g0.meter | 20 | 0 | 405 | 5000 | - | - | - | - | 1416.7 | EWS2400306 |
| g0-meter-S0-sp24-r0-s405-x | S0 | removal | g0.meter | 24 | 0 | 405 | 5000 | - | - | - | - | 1411.5 | EWS2400306 |
| g0-meter-S0-sp24-r0-s405-y | S0 | removal | g0.meter | 24 | 0 | 405 | 5000 | - | - | - | - | 1368.5 | EWS2400306 |
| g0-meter-S0-sp28-r0-s405-x | S0 | removal | g0.meter | 28 | 0 | 405 | 5000 | - | - | - | - | 1416.7 | EWS2400306 |
| g0-meter-S0-sp28-r0-s405-y | S0 | removal | g0.meter | 28 | 0 | 405 | 5000 | - | - | - | - | 1416.8 | EWS2400306 |
| g0-meter-S0-sp3-r0-s405-x | S0 | removal | g0.meter | 3 | 0 | 405 | 5000 | - | - | - | - | 1452.1 | EWS2400306 |
| g0-meter-S0-sp3-r0-s405-y | S0 | removal | g0.meter | 3 | 0 | 405 | 5000 | - | - | - | - | 1482.4 | EWS2400306 |
| g0-meter-S0-sp32-r0-s405-x | S0 | removal | g0.meter | 32 | 0 | 405 | 5000 | - | - | - | - | 1585.3 | EWS2400306 |
| g0-meter-S0-sp32-r0-s405-y | S0 | removal | g0.meter | 32 | 0 | 405 | 5000 | - | - | - | - | 1590.2 | EWS2400306 |
| g0-meter-S0-sp4-r0-s405-x | S0 | removal | g0.meter | 4 | 0 | 405 | 5000 | - | - | - | - | 1576.2 | EWS2400306 |
| g0-meter-S0-sp4-r0-s405-y | S0 | removal | g0.meter | 4 | 0 | 405 | 5000 | - | - | - | - | 1575.3 | EWS2400306 |
| g0-meter-S0-sp6-r0-s405-x | S0 | removal | g0.meter | 6 | 0 | 405 | 5000 | - | - | - | - | 1484.6 | EWS2400306 |
| g0-meter-S0-sp6-r0-s405-y | S0 | removal | g0.meter | 6 | 0 | 405 | 5000 | - | - | - | - | 1486 | EWS2400306 |
| g0-meter-S0-sp8-r0-s405-x | S0 | removal | g0.meter | 8 | 0 | 405 | 5000 | - | - | - | - | 1571.7 | EWS2400306 |
| g0-meter-S0-sp8-r0-s405-y | S0 | removal | g0.meter | 8 | 0 | 405 | 5000 | - | - | - | - | 1524 | EWS2400306 |
| g0-meter-S1-sp10-r0-s405-x | S1 | removal | g0.meter | 10 | 0 | 405 | 5000 | - | - | - | - | 1309.5 | EWS2400306 |
| g0-meter-S1-sp10-r0-s405-y | S1 | removal | g0.meter | 10 | 0 | 405 | 5000 | - | - | - | - | 1309.2 | EWS2400306 |
| g0-meter-S1-sp12-r0-s405-x | S1 | removal | g0.meter | 12 | 0 | 405 | 5000 | - | - | - | - | 1295.8 | EWS2400306 |
| g0-meter-S1-sp12-r0-s405-y | S1 | removal | g0.meter | 12 | 0 | 405 | 5000 | - | - | - | - | 1293.5 | EWS2400306 |
| g0-meter-S1-sp16-r0-s405-x | S1 | removal | g0.meter | 16 | 0 | 405 | 5000 | - | - | - | - | 1235.8 | EWS2400306 |
| g0-meter-S1-sp16-r0-s405-y | S1 | removal | g0.meter | 16 | 0 | 405 | 5000 | - | - | - | - | 1250.8 | EWS2400306 |
| g0-meter-S1-sp2-r0-s405-x | S1 | removal | g0.meter | 2 | 0 | 405 | 5000 | - | - | - | - | 1523.2 | EWS2400306 |
| g0-meter-S1-sp2-r0-s405-y | S1 | removal | g0.meter | 2 | 0 | 405 | 5000 | - | - | - | - | 1508.1 | EWS2400306 |
| g0-meter-S1-sp20-r0-s405-x | S1 | removal | g0.meter | 20 | 0 | 405 | 5000 | - | - | - | - | 1231.8 | EWS2400306 |
| g0-meter-S1-sp20-r0-s405-y | S1 | removal | g0.meter | 20 | 0 | 405 | 5000 | - | - | - | - | 1242.3 | EWS2400306 |
| g0-meter-S1-sp24-r0-s405-x | S1 | removal | g0.meter | 24 | 0 | 405 | 5000 | - | - | - | - | 1217.9 | EWS2400306 |
| g0-meter-S1-sp24-r0-s405-y | S1 | removal | g0.meter | 24 | 0 | 405 | 5000 | - | - | - | - | 1237.5 | EWS2400306 |
| g0-meter-S1-sp28-r0-s405-x | S1 | removal | g0.meter | 28 | 0 | 405 | 5000 | - | - | - | - | 1182.6 | EWS2400306 |
| g0-meter-S1-sp28-r0-s405-y | S1 | removal | g0.meter | 28 | 0 | 405 | 5000 | - | - | - | - | 1181.4 | EWS2400306 |
| g0-meter-S1-sp3-r0-s405-x | S1 | removal | g0.meter | 3 | 0 | 405 | 5000 | - | - | - | - | 1416.2 | EWS2400306 |
| g0-meter-S1-sp3-r0-s405-y | S1 | removal | g0.meter | 3 | 0 | 405 | 5000 | - | - | - | - | 1398.2 | EWS2400306 |
| g0-meter-S1-sp32-r0-s405-x | S1 | removal | g0.meter | 32 | 0 | 405 | 5000 | - | - | - | - | 1209.2 | EWS2400306 |
| g0-meter-S1-sp32-r0-s405-y | S1 | removal | g0.meter | 32 | 0 | 405 | 5000 | - | - | - | - | 1155.2 | EWS2400306 |
| g0-meter-S1-sp4-r0-s405-x | S1 | removal | g0.meter | 4 | 0 | 405 | 5000 | - | - | - | - | 1449.2 | EWS2400306 |
| g0-meter-S1-sp4-r0-s405-y | S1 | removal | g0.meter | 4 | 0 | 405 | 5000 | - | - | - | - | 1443.1 | EWS2400306 |
| g0-meter-S1-sp6-r0-s405-x | S1 | removal | g0.meter | 6 | 0 | 405 | 5000 | - | - | - | - | 1365.6 | EWS2400306 |
| g0-meter-S1-sp6-r0-s405-y | S1 | removal | g0.meter | 6 | 0 | 405 | 5000 | - | - | - | - | 1361.3 | EWS2400306 |
| g0-meter-S1-sp8-r0-s405-x | S1 | removal | g0.meter | 8 | 0 | 405 | 5000 | - | - | - | - | 1393.6 | EWS2400306 |
| g0-meter-S1-sp8-r0-s405-y | S1 | removal | g0.meter | 8 | 0 | 405 | 5000 | - | - | - | - | 1323.7 | EWS2400306 |
| g0-meter-S2-sp10-r0-s405-x | S2 | removal | g0.meter | 10 | 0 | 405 | 5000 | - | - | - | - | 1282.7 | EWS2400306 |
| g0-meter-S2-sp10-r0-s405-y | S2 | removal | g0.meter | 10 | 0 | 405 | 5000 | - | - | - | - | 1248 | EWS2400306 |
| g0-meter-S2-sp12-r0-s405-x | S2 | removal | g0.meter | 12 | 0 | 405 | 5000 | - | - | - | - | 1269.3 | EWS2400306 |
| g0-meter-S2-sp12-r0-s405-y | S2 | removal | g0.meter | 12 | 0 | 405 | 5000 | - | - | - | - | 1213.2 | EWS2400306 |
| g0-meter-S2-sp16-r0-s405-x | S2 | removal | g0.meter | 16 | 0 | 405 | 5000 | - | - | - | - | 1143.5 | EWS2400306 |
| g0-meter-S2-sp16-r0-s405-y | S2 | removal | g0.meter | 16 | 0 | 405 | 5000 | - | - | - | - | 1215.5 | EWS2400306 |
| g0-meter-S2-sp2-r0-s405-x | S2 | removal | g0.meter | 2 | 0 | 405 | 5000 | - | - | - | - | 1497.7 | EWS2400306 |
| g0-meter-S2-sp2-r0-s405-y | S2 | removal | g0.meter | 2 | 0 | 405 | 5000 | - | - | - | - | 1486.5 | EWS2400306 |
| g0-meter-S2-sp20-r0-s405-x | S2 | removal | g0.meter | 20 | 0 | 405 | 5000 | - | - | - | - | 1204.2 | EWS2400306 |
| g0-meter-S2-sp20-r0-s405-y | S2 | removal | g0.meter | 20 | 0 | 405 | 5000 | - | - | - | - | 1207.4 | EWS2400306 |
| g0-meter-S2-sp24-r0-s405-x | S2 | removal | g0.meter | 24 | 0 | 405 | 5000 | - | - | - | - | 1190.6 | EWS2400306 |
| g0-meter-S2-sp24-r0-s405-y | S2 | removal | g0.meter | 24 | 0 | 405 | 5000 | - | - | - | - | 1215.9 | EWS2400306 |
| g0-meter-S2-sp28-r0-s405-x | S2 | removal | g0.meter | 28 | 0 | 405 | 5000 | - | - | - | - | 1189.1 | EWS2400306 |
| g0-meter-S2-sp28-r0-s405-y | S2 | removal | g0.meter | 28 | 0 | 405 | 5000 | - | - | - | - | 1208.8 | EWS2400306 |
| g0-meter-S2-sp3-r0-s405-x | S2 | removal | g0.meter | 3 | 0 | 405 | 5000 | - | - | - | - | 1386.8 | EWS2400306 |
| g0-meter-S2-sp3-r0-s405-y | S2 | removal | g0.meter | 3 | 0 | 405 | 5000 | - | - | - | - | 1345.1 | EWS2400306 |
| g0-meter-S2-sp32-r0-s405-x | S2 | removal | g0.meter | 32 | 0 | 405 | 5000 | - | - | - | - | 1202.5 | EWS2400306 |
| g0-meter-S2-sp32-r0-s405-y | S2 | removal | g0.meter | 32 | 0 | 405 | 5000 | - | - | - | - | 1188.3 | EWS2400306 |
| g0-meter-S2-sp4-r0-s405-x | S2 | removal | g0.meter | 4 | 0 | 405 | 5000 | - | - | - | - | 1441.5 | EWS2400306 |
| g0-meter-S2-sp4-r0-s405-y | S2 | removal | g0.meter | 4 | 0 | 405 | 5000 | - | - | - | - | 1436.4 | EWS2400306 |
| g0-meter-S2-sp6-r0-s405-x | S2 | removal | g0.meter | 6 | 0 | 405 | 5000 | - | - | - | - | 1349.6 | EWS2400306 |
| g0-meter-S2-sp6-r0-s405-y | S2 | removal | g0.meter | 6 | 0 | 405 | 5000 | - | - | - | - | 1333.1 | EWS2400306 |
| g0-meter-S2-sp8-r0-s405-x | S2 | removal | g0.meter | 8 | 0 | 405 | 5000 | - | - | - | - | 1367 | EWS2400306 |
| g0-meter-S2-sp8-r0-s405-y | S2 | removal | g0.meter | 8 | 0 | 405 | 5000 | - | - | - | - | 1332.1 | EWS2400306 |
| g0-scan-S0-sp10-r0-s401 | S0 | removal | g0.scan | 10 | 0 | 401 | 26000 | CHURN | -0.001 | 0.556 | 1 | 1171 | EWS2400306 |
| g0-scan-S0-sp12-r0-s401 | S0 | removal | g0.scan | 12 | 0 | 401 | 26000 | CHURN | 0.000 | 0.501 | 1 | 1245.4 | EWS2400306 |
| g0-scan-S0-sp16-r0-s401 | S0 | removal | g0.scan | 16 | 0 | 401 | 26000 | CHURN | 0.012 | 0.578 | 1 | 1127.8 | EWS2400306 |
| g0-scan-S0-sp2-r0-s401 | S0 | removal | g0.scan | 2 | 0 | 401 | 6000 | NOSTART | - | - | - | 1394.3 | EWS2400306 |
| g0-scan-S0-sp20-r0-s401 | S0 | removal | g0.scan | 20 | 0 | 401 | 26000 | CHURN | 0.010 | 0.516 | 1 | 1166.6 | EWS2400306 |
| g0-scan-S0-sp24-r0-s401 | S0 | removal | g0.scan | 24 | 0 | 401 | 26000 | CHURN | 0.010 | 0.550 | 1 | 1180.2 | EWS2400306 |
| g0-scan-S0-sp28-r0-s401 | S0 | removal | g0.scan | 28 | 0 | 401 | 26000 | CHURN | -0.010 | 0.508 | 1 | 1224.5 | EWS2400306 |
| g0-scan-S0-sp3-r0-s401 | S0 | removal | g0.scan | 3 | 0 | 401 | 6000 | NOSTART | - | - | - | 1311.4 | EWS2400306 |
| g0-scan-S0-sp32-r0-s401 | S0 | removal | g0.scan | 32 | 0 | 401 | 6000 | NOSTART | - | - | - | 2129.8 | EWS2400306 |
| g0-scan-S0-sp4-r0-s401 | S0 | removal | g0.scan | 4 | 0 | 401 | 26000 | CHURN | 0.006 | 0.025 | 0.311 | 1375.6 | EWS2400306 |
| g0-scan-S0-sp6-r0-s401 | S0 | removal | g0.scan | 6 | 0 | 401 | 26000 | CHURN | -0.011 | 0.436 | 1 | 1241.3 | EWS2400306 |
| g0-scan-S0-sp8-r0-s401 | S0 | removal | g0.scan | 8 | 0 | 401 | 26000 | CHURN | -0.002 | 0.544 | 1 | 1257.7 | EWS2400306 |
| g0-scan-S1-sp10-r0-s401 | S1 | removal | g0.scan | 10 | 0 | 401 | 26000 | CHURN | -0.003 | 0.591 | 1 | 1100.6 | EWS2400306 |
| g0-scan-S1-sp12-r0-s401 | S1 | removal | g0.scan | 12 | 0 | 401 | 26000 | CHURN | 0.011 | 0.549 | 1 | 1086.5 | EWS2400306 |
| g0-scan-S1-sp16-r0-s401 | S1 | removal | g0.scan | 16 | 0 | 401 | 26000 | CHURN | 0.004 | 0.589 | 1 | 1064.1 | EWS2400306 |
| g0-scan-S1-sp2-r0-s401 | S1 | removal | g0.scan | 2 | 0 | 401 | 6000 | NOSTART | - | - | - | 1354.7 | EWS2400306 |
| g0-scan-S1-sp20-r0-s401 | S1 | removal | g0.scan | 20 | 0 | 401 | 26000 | CHURN | 0.017 | 0.611 | 1 | 1051.6 | EWS2400306 |
| g0-scan-S1-sp24-r0-s401 | S1 | removal | g0.scan | 24 | 0 | 401 | 26000 | CHURN | 0.018 | 0.603 | 1 | 1053.3 | EWS2400306 |
| g0-scan-S1-sp28-r0-s401 | S1 | removal | g0.scan | 28 | 0 | 401 | 26000 | CHURN | -0.018 | 0.411 | 1 | 1098.6 | EWS2400306 |
| g0-scan-S1-sp3-r0-s401 | S1 | removal | g0.scan | 3 | 0 | 401 | 6000 | NOSTART | - | - | - | 1288 | EWS2400306 |
| g0-scan-S1-sp32-r0-s401 | S1 | removal | g0.scan | 32 | 0 | 401 | 26000 | CHURN | -0.024 | 0.483 | 1 | 1063.6 | EWS2400306 |
| g0-scan-S1-sp4-r0-s401 | S1 | removal | g0.scan | 4 | 0 | 401 | 26000 | CHURN | -0.002 | 0.518 | 1 | 1208.2 | EWS2400306 |
| g0-scan-S1-sp6-r0-s401 | S1 | removal | g0.scan | 6 | 0 | 401 | 26000 | CHURN | 0.005 | 0.572 | 1 | 1131.3 | EWS2400306 |
| g0-scan-S1-sp8-r0-s401 | S1 | removal | g0.scan | 8 | 0 | 401 | 26000 | CHURN | -0.003 | 0.540 | 1 | 1140.8 | EWS2400306 |
| g0-scan-S2-sp10-r0-s401 | S2 | removal | g0.scan | 10 | 0 | 401 | 26000 | CHURN | 0.000 | 0.582 | 1 | 1066.2 | EWS2400306 |
| g0-scan-S2-sp12-r0-s401 | S2 | removal | g0.scan | 12 | 0 | 401 | 26000 | CHURN | -0.000 | 0.567 | 1 | 1065.4 | EWS2400306 |
| g0-scan-S2-sp16-r0-s401 | S2 | removal | g0.scan | 16 | 0 | 401 | 26000 | CHURN | -0.004 | 0.568 | 1 | 1033.8 | EWS2400306 |
| g0-scan-S2-sp2-r0-s401 | S2 | removal | g0.scan | 2 | 0 | 401 | 26000 | CHURN | -0.007 | 0.100 | 0.713 | 1353.1 | EWS2400306 |
| g0-scan-S2-sp20-r0-s401 | S2 | removal | g0.scan | 20 | 0 | 401 | 26000 | CHURN | -0.015 | 0.539 | 1 | 1050 | EWS2400306 |
| g0-scan-S2-sp24-r0-s401 | S2 | removal | g0.scan | 24 | 0 | 401 | 26000 | CHURN | -0.010 | 0.516 | 1 | 1053 | EWS2400306 |
| g0-scan-S2-sp28-r0-s401 | S2 | removal | g0.scan | 28 | 0 | 401 | 26000 | LATE | -0.035 | 0.488 | 1 | 1046.4 | EWS2400306 |
| g0-scan-S2-sp3-r0-s401 | S2 | removal | g0.scan | 3 | 0 | 401 | 26000 | CHURN | 0.002 | 0.123 | 0.746 | 1271.9 | EWS2400306 |
| g0-scan-S2-sp32-r0-s401 | S2 | removal | g0.scan | 32 | 0 | 401 | 26000 | CHURN | 0.018 | 0.525 | 1 | 1049.9 | EWS2400306 |
| g0-scan-S2-sp4-r0-s401 | S2 | removal | g0.scan | 4 | 0 | 401 | 26000 | CHURN | -0.006 | 0.583 | 1 | 1165.6 | EWS2400306 |
| g0-scan-S2-sp6-r0-s401 | S2 | removal | g0.scan | 6 | 0 | 401 | 26000 | CHURN | 0.007 | 0.568 | 1 | 1119.7 | EWS2400306 |
| g0-scan-S2-sp8-r0-s401 | S2 | removal | g0.scan | 8 | 0 | 401 | 26000 | CHURN | 0.000 | 0.537 | 1 | 1102.9 | EWS2400306 |

exit code 0: a verdict
