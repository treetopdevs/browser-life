# Food floor: both bands stay occupied and the late shifts recur

**Promising on this one seed.** The new food-floor world reaches 3,000 ticks with **34 bodies, families 15 / 0 / 19, and 10 distinct programs**. Both bands remain occupied at the required final checkpoints. All three late intervals pass both the numerical growth/retreat screen and parent body-only visual review. The independently initialized repeat matches exactly.

The historical all-or-nothing alternating version of seed 1202 ended with seven bodies and an empty second band. That record was reproduced exactly before this new outcome as a correctness check; it is not a new control. This is a descriptive difference from changing an engineered rule on one selected seed, not proof of reliable superiority, adaptation or improved fitness. Historical alternating seed 1203 had passed; it remains separate and was not rerun.

## What we engineered

Every five ticks, each band receives 96 offered units, and a majority band receives another 576. The majority switches every 500 ticks: 672 / 96, then 96 / 672. Total offered food stays at 768. Existing food remains. Biology, inherited programs, mutation and population limits are unchanged.

The frozen global-slot schedule feeds fixed subsets: 288 floor targets per band and 2,016 reachable targets per band in the whole schedule. The two geometric bands contain 4,608 tiles, but only 4,032 are replenished. This is not uniform feeding of every tile. Allocation and spatial footprint change together, so the result cannot isolate their effects.

## What happened

| Interval | Majority band | Body-tile change in bands 0 / 1 | Numerical and manual seasonal screen |
|---|---:|---:|---|
| 1,500–2,000 | 1 | −319 / +239 | Pass |
| 2,000–2,500 | 0 | +162 / −279 | Pass |
| 2,500–3,000 | 1 | −130 / +229 | Pass |

At 1,500, branching clusters occupy both bands. By 2,000, a dense middle-lower cluster expands in band 1 while much of the lower-left lattice clears in band 0. By 2,500, band 0 develops a large upper cluster and band 1's middle clears. By 3,000, band 1 again has expanded upper-middle and lower structures, while band 0 is sparser. These are changes in occupied tiles and gaps, not just colors or food shading. Growth and death can produce this pattern; the screen does not establish organism migration or learning.

Band occupancy at 1,500 / 2,000 / 2,500 / 3,000 is **400/217, 81/456, 243/177, 113/406**. Population is **37, 48, 35, 34** at those ages. The late minimum is 23 at tick 2,233; the whole-run minimum is 12 at initialization and the earliest ticks. There is no counterpart to the old world's fall to three. Gold is first absent at saved tick 1,900 (20-tick resolution), so three-family persistence does not occur. Mint and lilac appear in every saved sample; maximum-ever generation is 15.

Activity also passes: births/deaths/cap-48 ticks in the three late windows are **114/103/32, 77/90/8, 92/93/23**. None crosses the frozen 99-cap-tick limit. The required own-world 2,500–3,000 occupied-body change is visible.

New accepted food is 255,293 of 460,800 offered, compared with historical 207,132. Band acceptance is 132,965 / 122,328 in the new world. Equal offers do not guarantee equal uptake, and the floor does not guarantee survival. The reference's late body-tile changes, −579/0, +142/0 and −110/0, all fail the seasonal screen; that known failure is not changed.

## Evidence and decision

Plan 866a67f4 and reviewed source 46caddc5 preceded the single reserved attempt. Exact historical regression matched 151 samples/frames, 3,000 tick rows and seven complete snapshots before either new foothold world was constructed. The new record retains 151 samples/frames, 3,000 rows, seven snapshots and 513 lineage records. Its independent repeat matched 151 full-state and frame checks. Preflight tests did not advance biology.

Parent visual review was not blind to the historical record or numerical outcome. Its receipt binds both raw artifacts and records all late blocks and same-age comparisons. No overlap diagnostics were used. No extra seed, retry, tuning or horizon extension occurred.

Keep this engineered variant as promising and **stop this slice now**. The smallest next test would be one unchanged seed 1203 to the same 3,000-tick horizon under a separate reviewed plan, comparing with its already accepted alternating record. That would ask whether the visible two-band shifts recur on another seed. It is not authorized by this result to tune the floor or run farther automatically.

[Replay and animation](food-band-foothold.html) · [Frozen plan](food-band-foothold-plan.md) · [Summary](food-band-foothold-summary.json) · [Validation](food-band-foothold-validation.md). No merge or deployment.
