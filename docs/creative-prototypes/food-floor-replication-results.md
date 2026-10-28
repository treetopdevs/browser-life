# Food floor replication: two late shifts, followed by a decline

**Promising: all four frozen screens pass.** The unchanged food-floor rule reaches 3,000 ticks on seed 1203 with **16 bodies, families 0 / 9 / 7, and eight distinct programs**. Two of the three late growth/retreat intervals pass numerically. In the last interval both bands lose occupied tiles. This does not repeat seed 1202's all-three-block result. The independently initialized repeat matches exactly.

## What stayed fixed

This is one new replication, not a new rule. Every five ticks, offer 96 units to each band plus 576 to the majority band; switch the majority every 500 ticks. Both bands receive food throughout. Total offered food stays at 768 per pulse, initial food is 20 everywhere, and existing food remains. Biology, inherited programs, mutation and limits are unchanged. The fixed target schedule reaches 288 floor tiles per band and 2,016 replenished tiles per band overall, not every geometric tile. Allocation and footprint differ together from the historical all-or-nothing rule.

## What happened

| Interval | Majority band | Body-tile change in bands 0 / 1 | Numerical seasonal screen |
|---|---:|---:|---|
| 1,500–2,000 | 1 | −220 / +334 | Pass |
| 2,000–2,500 | 0 | +150 / −271 | Pass |
| 2,500–3,000 | 1 | −208 / −40 | Fail |

Band occupancy at 1,500 / 2,000 / 2,500 / 3,000 is **320/195, 100/529, 250/258, 42/218**. Both bands exceed the frozen ten-tile threshold at 2,500 and 3,000. The last block fails because majority-fed band 1 loses 40 tiles rather than gaining at least 20; minority-fed band 0 loses 208.

Population at those ages is **34, 48, 42, 16**. The late minimum is 13 at tick 2,953, followed by 16 at the endpoint. This short rise is descriptive, not evidence of adaptation or a durable recovery. The whole-run minimum is 12, first at initialization. Mint is first absent at saved tick 2,900 (20-tick sampling); gold and lilac remain in every saved sample. Three-family persistence does not occur. Maximum-ever generation is 15.

Births/deaths/cap-48 ticks in the late windows are **98/84/7, 99/105/12, 63/89/0**. All pass the activity screen. Accepted food is **240,288 of 460,800 offered**, split **129,598 / 110,690** between bands. Equal offered food does not ensure equal uptake or survival.

## Historical references and interpretation

The accepted alternating seed 1203 ends with 31 bodies, families 7/2/22 and 11 programs, and accepted 247,476 units. Its numerical seasonal deltas are −431/+423, −9/−474 and +76/+197: one qualifying block. It already passed its full screen. Its exact reproduction here is a known correctness check, not a new control outcome. A food-floor pass therefore cannot establish unique growth/retreat, reliable superiority or causation.

Historical food-floor seed 1202 remains a separate accepted pass with all three late blocks qualifying. Parent body-only review passes the first two qualifying intervals and the required own-world 2,500–3,000 change; the third interval fails. The full permissive screen recurs in two selected trajectories, while the all-three-block observation does not recur. This does not establish adaptation, improved fitness, learned migration, durable coexistence or independent colonies.

## Evidence and stop

Reviewed plan ab3c601c and source 1b49cc62 preceded the single reserved attempt, 20261027T165600Z-38935. The exact historical regression compared all 151 samples/frames, 3,000 tick rows and seven full snapshots before either new world was constructed. The new record retains 151 samples/frames, 3,000 rows, seven snapshots and 474 lineage records. Independent repeat proof covers 151 full-state and frame checks through 3,000. No retry, extra seed, tuning or extension occurred.

Parent body-only review was not blind to the reference or numerical outcomes. In the first block, dense upper and lower band-1 clusters expand while upper-left and lower-left band-0 bodies clear. In the second, a broad central-left group develops in band 0 while the upper band-1 mass clears. The third loses structure in both bands and fails the required expansion criterion. The central-left group clears to small fragments from 2,500 to 3,000, with larger open gaps in band 1, passing the separate own-world change gate. Same-age historical comparisons and all three block judgments are recorded in the receipt; no overlap diagnostics were used.

The SHA-bound parent receipt is b4c332a7a34e8aa494c1b749c00844eed1aabc5646d52a6bc0e2d49b281f0345; new raw artifact SHA256 7b535bf0eb53c1c3ee192974efd7de61fa15bb99fe84308478b1639eaa8b753d. Keep the rule as promising, and **stop this slice now**. No further seed, horizon or rule change is earned automatically. No merge or deployment.

[Replay and animation](food-floor-replication.html) · [Frozen plan](food-floor-replication-plan.md) · [Summary](food-floor-replication-summary.json) · [Validation](food-floor-replication-validation.md).

## Replay delivery

The [paired replay](food-floor-replication.html) includes a 151-frame, 15.1-second animation of exact saved ages 0–3,000. The historical alternating world is on the left; new food-floor world is on the right. Capture HTML is preserved separately. Both actual evidence and video/mobile browser checks pass. No additional biological run was used for media.
