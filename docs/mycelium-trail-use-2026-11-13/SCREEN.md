# Mycelium trail use: exploratory screen (13 Nov 2026)

**Label: EXPLORATION, not a test.** About 4 seeds per cell, no pre-registration, no multiplicity control, no noise floor. It can only suggest which variant, if any, deserves a pre-registered rung. Rule and reasoning: `DESIGN.md` here and the "Trail use" section of `tools/mycelium/RULES.md`.

## What ran

- Rule: optional `trailMoveDiscount` `td` (0..256) and `trailDiscountMode` (`public` or `toll`). Movement term `(raw * (256 - f)) >> 15`, `f = min(min(P0, 256) * td, 256)`, `P0` the start-of-step trail in the particle's own cell; toll sets `f = 0` unless the deposit request is positive.
- Runner: `tools/mycelium/trail-screen.ts` (GPU, one process, 5 jobs; baseline strata with 4 jobs). Ledgers (matter and energy) checked on the full state every 100 steps. Census, observer and window means are R2b's own (`R2bObserver`, `runValues`), so TM, `d` and median age mean what they meant there.
- **100,000 steps** (not 50,000), 128 x 128, default config except where stated. Windows: late = (50k, 100k], early = (10k, 20k].
- Arms inherit and blocked. World seeds 8001-8004 (inherit) and 108001-108004 (blocked, offset 100,000), checked against the R2/R2b embargo before starting; none of R2, R2b or R3's seeds. Every variant at an arm and seed shares the world seed (same founders; trajectories diverge from step 1 once the rule bites, so the pairing is weak).
- **Two strata.** `mc2` is the default world (`moveCost` 2). `mc12` is a **departure from the defaults**: `moveCost` 12, so the movement term is up to 23 energy and a discount is worth several units of deposit cost (DESIGN.md, "Economics"). Each stratum has its own keyless baseline (`-base`); numbers do not compare across strata.
- 80 runs (10 variants x 2 arms x 4 seeds), all started and finished in `run-log.jsonl`; all 80 are listed below. Wall time: the 16 baseline runs 127 s each with 4 jobs in parallel (about 9 min), the other 64 with 5 jobs about 45 min, on a Mac where the R3 test and other work were also using the GPU (load average 55-70). About 1 h in all for the screen.
- Sanity gate, passed before any variant was read: the keyless baselines reproduce R2b's pattern. Inherit trail is mostly gone by (50k, 100k] (median TM 0.016 at `mc2`, 0.015 at `mc12`; one seed in each stratum, 8001, keeps 0.5 and 0.2), blocked holds 1.75-2.44 per particle (R2b: 1.8-2.4), blocked median age is about 60,000 and inherit's a few hundred.

## Results

TM = trail per particle (mean over the window's 100-step censuses), `d` = the R2b deposit measure (matter deposited per particle in the next step), n = population (mean over the window), sum P = trail matter in the field (total matter in the world is 819,200), median age = mean over the window's heavy censuses of the median age. Seeds are listed in order 8001 to 8004.

| variant | arm | TM early (10k,20k] | TM late seeds (50k,100k] | TM late median | d late | n late | sum P late | median age late | min n | ledger |
|---|---|---|---|---|---|---|---|---|---|---|
| mc2-base | inherit | 0.046 | 0.52 / 0.03 / 0.00 / 0.00 | 0.016 | 0.0002 | 5894 | 81 | 373 | 1696 | 4000/4000 exact |
| mc2-base | blocked | 3.025 | 2.17 / 2.17 / 1.75 / 2.21 | 2.167 | 0.0217 | 4706 | 10199 | 59648 | 1063 | 4000/4000 exact |
| mc2-pub128 | inherit | 0.055 | 0.18 / 0.00 / 0.00 / 0.00 | 0.000 | 0.0000 | 5219 | 1 | 727 | 1688 | 4000/4000 exact |
| mc2-pub128 | blocked | 4.499 | 3.86 / 3.67 / 3.99 / 3.82 | 3.840 | 0.0387 | 4808 | 18467 | 57385 | 1067 | 4000/4000 exact |
| mc2-toll256 | inherit | 0.026 | 99.44 / 0.00 / 0.00 / 0.00 | 0.001 | 0.0000 | 5493 | 6 | 386 | 1711 | 4000/4000 exact |
| mc2-toll256 | blocked | 6.072 | 5.61 / 5.63 / 5.39 / 5.39 | 5.502 | 0.0557 | 4671 | 25681 | 59871 | 1061 | 4000/4000 exact |
| mc12-base | inherit | 0.100 | 0.20 / 0.00 / 0.02 / 0.02 | 0.015 | 0.0002 | 5143 | 81 | 520 | 869 | 4000/4000 exact |
| mc12-base | blocked | 4.134 | 2.15 / 2.44 / 2.11 / 2.09 | 2.130 | 0.0214 | 3207 | 6831 | 64272 | 588 | 4000/4000 exact |
| mc12-pub16 | inherit | 4.968 | 0.17 / 0.01 / 27.89 / 0.09 | 0.128 | 0.0013 | 5128 | 658 | 514 | 903 | 4000/4000 exact |
| mc12-pub16 | blocked | 9.629 | 6.78 / 6.49 / 6.39 / 6.90 | 6.638 | 0.0667 | 3228 | 21504 | 64557 | 599 | 4000/4000 exact |
| mc12-pub64 | inherit | 11.167 | 17.64 / 0.01 / 0.00 / 0.00 | 0.007 | 0.0001 | 4805 | 38 | 553 | 963 | 4000/4000 exact |
| mc12-pub64 | blocked | 14.296 | 14.78 / 14.05 / 14.51 / 14.43 | 14.469 | 0.1460 | 3514 | 50848 | 68933 | 652 | 4000/4000 exact |
| mc12-pub256 | inherit | 8.477 | 13.53 / 13.93 / 5.61 / 0.01 | 9.570 | 0.0962 | 4838 | 47614 | 249 | 1005 | 4000/4000 exact |
| mc12-pub256 | blocked | 12.020 | 11.51 / 12.09 / 11.76 / 11.82 | 11.791 | 0.1190 | 3957 | 46657 | 65361 | 693 | 4000/4000 exact |
| mc12-toll16 | inherit | 97.142 | 99.28 / 0.00 / 98.93 / 98.79 | 98.862 | 0.9978 | 4002 | 385093 | 751 | 894 | 4000/4000 exact |
| mc12-toll16 | blocked | 27.493 | 33.57 / 31.94 / 33.22 / 29.69 | 32.580 | 0.3292 | 3078 | 100532 | 65333 | 590 | 4000/4000 exact |
| mc12-toll64 | inherit | 100.021 | 99.18 / 98.97 / 100.52 / 98.62 | 99.076 | 1.0002 | 4068 | 405039 | 474 | 934 | 4000/4000 exact |
| mc12-toll64 | blocked | 73.800 | 94.18 / 94.72 / 93.74 / 94.07 | 94.129 | 0.9506 | 3525 | 332145 | 45665 | 626 | 4000/4000 exact |
| mc12-toll256 | inherit | 98.705 | 99.49 / 98.60 / 100.16 / 98.80 | 99.146 | 1.0007 | 4079 | 404292 | 557 | 938 | 4000/4000 exact |
| mc12-toll256 | blocked | 74.495 | 94.22 / 94.50 / 94.27 / 94.37 | 94.322 | 0.9526 | 3524 | 332725 | 45280 | 649 | 4000/4000 exact |

Every run is in the second table; no run was dropped, repeated or re-seeded. Ledgers were exact (residual 0) at all 80,000 checks (1,000 per run) of all 80 runs. No population guard trip (lowest n at any census: 588).

## Reading

Plain language, with 4 seeds a cell:

1. **Toll at `moveCost` 12 keeps the trail.** In the inherit arm trail stays at about 99 per particle (late window) in 11 of 12 seeds across toll strengths 16, 64 and 256 (strength 16 loses one seed to 0.00; strengths 64 and 256 keep all four), with populations of about 4,000 (against about 5,100 for the keyless baseline) and no collapse. The keyless baseline keeps it in 0 of 4 at that level. The mechanism is the one the design predicted: the discount is only for particles that ask to deposit, so asking is rewarded. It is not a subtle result at this size of effect (99 against 0.02 on the same seeds), but it is 4 seeds.
2. **What kind of state it is.** The kept trail is about 99 per particle with `d` at 1.00: the mean deposit is one unit per particle per step (my reading, not measured per particle: mixed deposits could average the same, and some rows are 1.01), the least a controller can ask for in steady state, and 1% decay puts the field at about 100 per particle. That is half the matter of the world locked in trail (sum P about 400,000 of 819,200), and the median age stays at a few hundred to about a thousand (the same short-lived life history as keyless inherit). So trail looks held at a floor set by the deposit quantum rather than grown (an interpretation of `d` and TM, not tested). The observer also stores Moran's I, but spatial structure was not analysed here, so this says nothing about networks or mycelium-like form.
3. **Blocked also rises under toll** (94 per particle at strengths 64 and 256, 33 at 16, against 2.1 keyless). That is not selection on heredity: random controllers are redrawn at every birth, and survival alone favours the ones that request a deposit. So inherit minus blocked is not a clean heredity contrast here. Inherit is at or above blocked in all three toll variants (99 against 94, 99 against 94, 99 against 33).
4. **Public discount does not reliably keep it.** At default `moveCost` (`mc2-pub128`) inherit has trail in 1 of 4 seeds, at 0.18, nothing like blocked's 3.8. At `moveCost` 12: strength 16 keeps one seed (27.9) of four, strength 64 one (17.6) of four, strength 256 three of four (13.5, 13.9, 5.6; median 9.6, against blocked's 11.8) with populations about 4,800. So only the strongest public discount comes near blocked, and with a seed that still loses everything. This fits the free-rider reading, which was a prior and is not shown by this screen.
5. **At the default `moveCost` the toll arm is mostly null, as the economics predicted** (DESIGN.md): one seed of four (8001) went to the 99-per-particle state, three stayed at 0. It is a hint that the switch can happen even there, not more.
6. **Early window.** Public arms often had large early trail (for example `mc12-pub64` inherit 11 early) that then decayed; the toll arms at `mc12` were already at about 99 by (10k, 20k] in most seeds. Trail that is gone by 50,000 and was there at 20,000 is the R2b pattern.

## Which variants keep inherit near or above blocked, and viability

- Toll, `mc12`, strengths 16 / 64 / 256: inherit TM above blocked's in each (98.9 / 99.1 / 99.1 median against 32.6 / 94.1 / 94.3). Populations viable (median n about 4,000, min n 894-938 early in the run, never near the cap).
- Public, `mc12`, strength 256: inherit median 9.6 against blocked 11.8, and 3 of 4 seeds above 5. Viable (n about 4,800).
- Everything else (public 16 and 64 at `mc12`, public 128 and toll 256 at `mc2`): inherit median near zero, below blocked.

## What this does not show

- Not a test: 4 seeds, no registered thresholds, 10 variants looked at. Differences within a stratum between variants are not estimated.
- Nothing about whether the trail is *used* by the controllers (sensor use, trail following), about spatial organisation, or about open-ended change. The kept state looks like a subscription that every particle pays once to get a cheaper step.
- `moveCost` 12 is a different world from the default, chosen so that the economics could work. The default world's own result is the `mc2` rows, which are mostly null.
- The toll gate is on the request, so a particle that cannot afford the unit still gets the discount (`DESIGN.md`, edge). At the default `depositCost` 2 that is rare; this screen never varied `depositCost`.
- Blocked is not "inherit minus heredity" (R2b RESULT.md).

## Suggestion for a pre-registered rung

If one is worth running: toll at `moveCost` 12 with `td` 64 (the smallest strength at which all four inherit seeds kept the trail), against its own keyless baseline and against a matched trail-following physarum null whose deposit rate is not below the 1/16 floor that blocked R2b (here `d` is about 1). Before that, decide what the rung would show beyond "paying for a subsidy is stable": a readout of trail use (does movement follow the trail, does the population's spatial pattern differ from a toll physarum) is what the design never measured. The public discount at 256 is the second candidate; it is the one that does not hand out the benefit only to payers.

## Every run

| run | world seed | TM late | d late | n late | age late | TM early | ledger |
|---|---|---|---|---|---|---|---|
| mc12-base.blocked.8001 | 108001 | 2.154 | 0.0218 | 3209 | 63701 | 3.960 | 1000/1000 |
| mc12-base.blocked.8002 | 108002 | 2.436 | 0.0246 | 3207 | 64197 | 4.534 | 1000/1000 |
| mc12-base.blocked.8003 | 108003 | 2.107 | 0.0210 | 3205 | 64487 | 3.947 | 1000/1000 |
| mc12-base.blocked.8004 | 108004 | 2.093 | 0.0210 | 3206 | 64347 | 4.307 | 1000/1000 |
| mc12-base.inherit.8001 | 8001 | 0.202 | 0.0020 | 4676 | 455 | 0.754 | 1000/1000 |
| mc12-base.inherit.8002 | 8002 | 0.000 | 0.0000 | 5024 | 527 | 0.062 | 1000/1000 |
| mc12-base.inherit.8003 | 8003 | 0.015 | 0.0002 | 5339 | 512 | 0.020 | 1000/1000 |
| mc12-base.inherit.8004 | 8004 | 0.016 | 0.0002 | 5262 | 630 | 0.138 | 1000/1000 |
| mc12-pub16.blocked.8001 | 108001 | 6.781 | 0.0680 | 3226 | 64336 | 9.762 | 1000/1000 |
| mc12-pub16.blocked.8002 | 108002 | 6.495 | 0.0654 | 3255 | 63893 | 9.495 | 1000/1000 |
| mc12-pub16.blocked.8003 | 108003 | 6.386 | 0.0643 | 3231 | 64777 | 9.431 | 1000/1000 |
| mc12-pub16.blocked.8004 | 108004 | 6.904 | 0.0697 | 3215 | 64996 | 9.790 | 1000/1000 |
| mc12-pub16.inherit.8001 | 8001 | 0.169 | 0.0018 | 5034 | 508 | 9.694 | 1000/1000 |
| mc12-pub16.inherit.8002 | 8002 | 0.007 | 0.0001 | 5221 | 521 | 30.178 | 1000/1000 |
| mc12-pub16.inherit.8003 | 8003 | 27.890 | 0.2811 | 4802 | 352 | 0.241 | 1000/1000 |
| mc12-pub16.inherit.8004 | 8004 | 0.086 | 0.0009 | 5401 | 579 | 0.089 | 1000/1000 |
| mc12-pub256.blocked.8001 | 108001 | 11.511 | 0.1161 | 3895 | 66237 | 11.961 | 1000/1000 |
| mc12-pub256.blocked.8002 | 108002 | 12.094 | 0.1221 | 3966 | 65412 | 12.300 | 1000/1000 |
| mc12-pub256.blocked.8003 | 108003 | 11.760 | 0.1186 | 3949 | 65310 | 11.963 | 1000/1000 |
| mc12-pub256.blocked.8004 | 108004 | 11.821 | 0.1194 | 3965 | 65146 | 12.077 | 1000/1000 |
| mc12-pub256.inherit.8001 | 8001 | 13.528 | 0.1354 | 5204 | 165 | 17.722 | 1000/1000 |
| mc12-pub256.inherit.8002 | 8002 | 13.927 | 0.1411 | 5700 | 210 | 7.363 | 1000/1000 |
| mc12-pub256.inherit.8003 | 8003 | 5.612 | 0.0570 | 4419 | 287 | 8.834 | 1000/1000 |
| mc12-pub256.inherit.8004 | 8004 | 0.010 | 0.0001 | 4473 | 586 | 8.119 | 1000/1000 |
| mc12-pub64.blocked.8001 | 108001 | 14.784 | 0.1492 | 3526 | 68838 | 14.991 | 1000/1000 |
| mc12-pub64.blocked.8002 | 108002 | 14.054 | 0.1417 | 3491 | 69147 | 14.359 | 1000/1000 |
| mc12-pub64.blocked.8003 | 108003 | 14.506 | 0.1462 | 3512 | 68987 | 14.234 | 1000/1000 |
| mc12-pub64.blocked.8004 | 108004 | 14.432 | 0.1459 | 3517 | 68880 | 14.233 | 1000/1000 |
| mc12-pub64.inherit.8001 | 8001 | 17.644 | 0.1787 | 3911 | 571 | 72.781 | 1000/1000 |
| mc12-pub64.inherit.8002 | 8002 | 0.014 | 0.0001 | 5375 | 677 | 3.856 | 1000/1000 |
| mc12-pub64.inherit.8003 | 8003 | 0.000 | 0.0000 | 4234 | 356 | 18.477 | 1000/1000 |
| mc12-pub64.inherit.8004 | 8004 | 0.000 | 0.0000 | 5385 | 534 | 2.619 | 1000/1000 |
| mc12-toll16.blocked.8001 | 108001 | 33.574 | 0.3389 | 3071 | 65312 | 28.161 | 1000/1000 |
| mc12-toll16.blocked.8002 | 108002 | 31.943 | 0.3226 | 3090 | 65354 | 27.747 | 1000/1000 |
| mc12-toll16.blocked.8003 | 108003 | 33.217 | 0.3359 | 3081 | 64872 | 27.238 | 1000/1000 |
| mc12-toll16.blocked.8004 | 108004 | 29.685 | 0.3001 | 3076 | 65750 | 24.890 | 1000/1000 |
| mc12-toll16.inherit.8001 | 8001 | 99.277 | 1.0023 | 3802 | 1147 | 99.560 | 1000/1000 |
| mc12-toll16.inherit.8002 | 8002 | 0.000 | 0.0000 | 5466 | 688 | 8.531 | 1000/1000 |
| mc12-toll16.inherit.8003 | 8003 | 98.934 | 0.9986 | 4028 | 814 | 95.730 | 1000/1000 |
| mc12-toll16.inherit.8004 | 8004 | 98.791 | 0.9971 | 3975 | 562 | 98.554 | 1000/1000 |
| mc12-toll256.blocked.8001 | 108001 | 94.217 | 0.9510 | 3544 | 45000 | 75.563 | 1000/1000 |
| mc12-toll256.blocked.8002 | 108002 | 94.498 | 0.9539 | 3528 | 44447 | 74.027 | 1000/1000 |
| mc12-toll256.blocked.8003 | 108003 | 94.275 | 0.9520 | 3519 | 45559 | 73.713 | 1000/1000 |
| mc12-toll256.blocked.8004 | 108004 | 94.370 | 0.9531 | 3519 | 45817 | 74.963 | 1000/1000 |
| mc12-toll256.inherit.8001 | 8001 | 99.494 | 1.0045 | 3919 | 1624 | 99.874 | 1000/1000 |
| mc12-toll256.inherit.8002 | 8002 | 98.600 | 0.9953 | 4245 | 253 | 98.554 | 1000/1000 |
| mc12-toll256.inherit.8003 | 8003 | 100.165 | 1.0109 | 3895 | 860 | 98.789 | 1000/1000 |
| mc12-toll256.inherit.8004 | 8004 | 98.798 | 0.9970 | 4239 | 241 | 98.621 | 1000/1000 |
| mc12-toll64.blocked.8001 | 108001 | 94.183 | 0.9514 | 3522 | 45478 | 74.165 | 1000/1000 |
| mc12-toll64.blocked.8002 | 108002 | 94.722 | 0.9559 | 3517 | 45853 | 75.266 | 1000/1000 |
| mc12-toll64.blocked.8003 | 108003 | 93.737 | 0.9460 | 3528 | 46163 | 72.897 | 1000/1000 |
| mc12-toll64.blocked.8004 | 108004 | 94.074 | 0.9498 | 3536 | 43895 | 73.436 | 1000/1000 |
| mc12-toll64.inherit.8001 | 8001 | 99.177 | 1.0013 | 4010 | 1113 | 101.267 | 1000/1000 |
| mc12-toll64.inherit.8002 | 8002 | 98.975 | 0.9991 | 4226 | 251 | 98.775 | 1000/1000 |
| mc12-toll64.inherit.8003 | 8003 | 100.522 | 1.0148 | 4046 | 669 | 103.593 | 1000/1000 |
| mc12-toll64.inherit.8004 | 8004 | 98.623 | 0.9958 | 4090 | 279 | 98.450 | 1000/1000 |
| mc2-base.blocked.8001 | 108001 | 2.167 | 0.0217 | 4697 | 59600 | 3.016 | 1000/1000 |
| mc2-base.blocked.8002 | 108002 | 2.168 | 0.0217 | 4713 | 59780 | 3.033 | 1000/1000 |
| mc2-base.blocked.8003 | 108003 | 1.752 | 0.0177 | 4715 | 59696 | 2.772 | 1000/1000 |
| mc2-base.blocked.8004 | 108004 | 2.213 | 0.0224 | 4699 | 59552 | 3.195 | 1000/1000 |
| mc2-base.inherit.8001 | 8001 | 0.522 | 0.0050 | 6180 | 292 | 5.442 | 1000/1000 |
| mc2-base.inherit.8002 | 8002 | 0.031 | 0.0003 | 4839 | 1085 | 0.093 | 1000/1000 |
| mc2-base.inherit.8003 | 8003 | 0.001 | 0.0000 | 5634 | 325 | 0.000 | 1000/1000 |
| mc2-base.inherit.8004 | 8004 | 0.000 | 0.0000 | 6154 | 421 | 0.000 | 1000/1000 |
| mc2-pub128.blocked.8001 | 108001 | 3.858 | 0.0390 | 4805 | 57381 | 4.351 | 1000/1000 |
| mc2-pub128.blocked.8002 | 108002 | 3.674 | 0.0371 | 4803 | 57445 | 4.478 | 1000/1000 |
| mc2-pub128.blocked.8003 | 108003 | 3.986 | 0.0403 | 4819 | 56718 | 4.756 | 1000/1000 |
| mc2-pub128.blocked.8004 | 108004 | 3.823 | 0.0385 | 4812 | 57388 | 4.520 | 1000/1000 |
| mc2-pub128.inherit.8001 | 8001 | 0.180 | 0.0019 | 4806 | 3794 | 14.105 | 1000/1000 |
| mc2-pub128.inherit.8002 | 8002 | 0.000 | 0.0000 | 5037 | 1029 | 0.107 | 1000/1000 |
| mc2-pub128.inherit.8003 | 8003 | 0.000 | 0.0000 | 5402 | 287 | 0.000 | 1000/1000 |
| mc2-pub128.inherit.8004 | 8004 | 0.000 | 0.0000 | 6097 | 425 | 0.004 | 1000/1000 |
| mc2-toll256.blocked.8001 | 108001 | 5.611 | 0.0568 | 4657 | 60790 | 5.866 | 1000/1000 |
| mc2-toll256.blocked.8002 | 108002 | 5.634 | 0.0571 | 4673 | 60024 | 6.221 | 1000/1000 |
| mc2-toll256.blocked.8003 | 108003 | 5.387 | 0.0544 | 4669 | 59718 | 5.923 | 1000/1000 |
| mc2-toll256.blocked.8004 | 108004 | 5.393 | 0.0545 | 4679 | 59459 | 6.349 | 1000/1000 |
| mc2-toll256.inherit.8001 | 8001 | 99.445 | 1.0041 | 3796 | 1414 | 84.739 | 1000/1000 |
| mc2-toll256.inherit.8002 | 8002 | 0.002 | 0.0000 | 5467 | 218 | 0.047 | 1000/1000 |
| mc2-toll256.inherit.8003 | 8003 | 0.000 | 0.0000 | 5519 | 328 | 0.002 | 1000/1000 |
| mc2-toll256.inherit.8004 | 8004 | 0.000 | 0.0000 | 6097 | 445 | 0.005 | 1000/1000 |
