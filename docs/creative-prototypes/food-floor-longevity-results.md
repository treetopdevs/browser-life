# Food-floor longevity: a late rebound after a deep trough

**Promising at 6,000: all four frozen screens pass.** Seed 1203 reaches 6,000 ticks with **34 bodies, families 0 / 28 / 6, and 15 distinct programs**. It first falls to five bodies at tick 3,357, then eventually crosses 32 bodies at tick 5,600. The last 500 ticks average **26.182 bodies**, below the chosen mean-of-32 sustained-population summary. A late rebound occurred; that summary did not pass. Neither descriptor changes the frozen gates.

The rule is unchanged: both bands receive 96 units per five-tick pulse, plus 576 in a majority band that switches every 500 ticks. Existing food remains. Biology, mutation, inheritance and limits are unchanged. The target schedule continues across tick 3,000 without resetting. The accepted first 3,000 ticks are known correctness evidence; only 3,001–6,000 are new. This is a selected declining trajectory, not an unbiased seed or a new control comparison.

## Every new 500-tick interval

| Window | Population min / mean / max / end | End families | Births / deaths / cap48 | Band occupancy | Offered / accepted / overflow |
| --- | --- | --- | --- | --- | --- |
| 3,001–3,500 | 5 / 11 / 23 / 6 | 0 / 1 / 5 | 30 / 40 / 0 | 86 / 24 | 76800 / 25080 / 51720 |
| 3,501–4,000 | 5 / 9.022 / 17 / 17 | 0 / 10 / 7 | 30 / 19 / 0 | 85 / 128 | 76800 / 23898 / 52902 |
| 4,001–4,500 | 8 / 13.562 / 21 / 11 | 0 / 6 / 5 | 37 / 43 / 0 | 85 / 76 | 76800 / 15103 / 61697 |
| 4,501–5,000 | 9 / 13.604 / 20 / 15 | 0 / 10 / 5 | 37 / 33 / 0 | 73 / 181 | 76800 / 18082 / 58718 |
| 5,001–5,500 | 12 / 18.448 / 28 / 20 | 0 / 7 / 13 | 52 / 47 / 0 | 258 / 126 | 76800 / 15538 / 61262 |
| 5,501–6,000 | 19 / 26.182 / 41 / 34 | 0 / 28 / 6 | 88 / 74 / 0 | 75 / 371 | 76800 / 26869 / 49931 |

All six windows are complete. Population stays low for much of the continuation, so the endpoint of 34 should not be read as sustained high abundance. Mint was already absent at the accepted 3,000 endpoint; its loss is not a new event in this continuation. Maximum-ever generation reaches 32, a descriptive lineage count rather than evidence of improved fitness.

## Late spatial changes

| Interval | Majority band | Occupied-tile change, bands 0 / 1 | Numerical seasonal screen |
| --- | --- | --- | --- |
| 4,500–5,000 | 1 | −12 / +105 | Fail: minority retreat is less than 20 |
| 5,000–5,500 | 0 | +185 / −55 | Pass |
| 5,500–6,000 | 1 | −183 / +245 | Pass |

Both bands exceed ten occupied tiles at 5,500 (258 / 126) and 6,000 (75 / 371). All three late activity windows have births and deaths and zero cap-48 ticks. The parent body-only review confirms both qualifying intervals and own-world 5,500–6,000 change. From 5,000 to 5,500, band 0 builds a dense central-left lattice while band 1 clears upper and middle structure. From 5,500 to 6,000, band 1 expands upper-edge branching and a dense bottom cluster while band 0 clears to two small groups. The first interval remains a failure. Review was explicitly not blind to historical and numerical evidence.

## Evidence and stop

Reviewed plan c3197555 and source d34fd297 preceded the single attempt 20261027T175755Z-96975. Both independently initialized worlds exactly reproduce all 151 historical samples/frames, 3,000 rows and seven snapshots. The complete prefix and historical final projection are checked and the prefix-verified journal is durably written before either world advances to 3,001. The same worlds then continue; no alternating control or separate historical traversal runs.

The complete record retains 301 samples/frames, 6,000 tick rows, 13 snapshots and 748 lineage records. Independent repeat proof covers 301 full-state and frame checks through 6,000. Candidate/raw bytes, intent hash and durable prefix proof match the attempt manifest.

Parent receipt SHA256 aa15a068d511f768836ccfb4318bed013cc7c992d1b8f0810008a9d4b1d8258b binds new raw SHA256 25e2e563350c1f70ac3307c1d766c61f29fac4935f68f0e7f0ef37ad9c43dfd4 and accepted prefix SHA256 7b535bf0eb53c1c3ee192974efd7de61fa15bb99fe84308478b1639eaa8b753d. It records all three intervals and the historical 3,000 reference; no overlap diagnostics were used. No retries, extra seeds, parameter changes or horizon extensions occurred. Stop after this outcome. No adaptation, reliable superiority, learned migration or durable coexistence claim. No merge or deployment.

[Replay and animation](food-floor-longevity.html) · [Plan](food-floor-longevity-plan.md) · [Summary](food-floor-longevity-summary.json) · [Validation](food-floor-longevity-validation.md).

## Animation and checks

The [saved replay](food-floor-longevity.html) includes a 301-frame, 30.1-second animation with the full population chart. Ages through 3,000 are labeled verified history; later ages are new continuation. Both actual evidence and video/mobile checks pass. Historical bytes and the exact capture HTML are preserved. No additional biological run was used for media.
