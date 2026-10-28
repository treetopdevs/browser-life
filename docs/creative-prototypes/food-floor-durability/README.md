# Food-floor durability comparison: seeds 1203 and 1202

28 October 2026. Retrospective, descriptive analysis of the two completed, selected 6,000-tick `foothold-band` trajectories. **Both survive; sustained high abundance, founder diversity, and spatial persistence do not hold across both seeds.** Seed 1203 shows a late rebound with two remaining families; seed 1202 survives after losing another family and occupation of one feeding band.

## Evidence and alignment

Sources are the committed raw records and frozen results from [PR #115](https://github.com/treetopdevs/browser-life/pull/115) (seed 1203, head `5022964538ebdc7c29963abd7a708eb87c1dee7c`) and [PR #116](https://github.com/treetopdevs/browser-life/pull/116) (seed 1202, head `9085497e1561606d6209f42a7df43f05d165e0c7`). The latter includes the former's raw evidence unchanged. [Provenance](provenance.json) pins paths, source hashes, output hashes, field definitions, and derivations.

- [Aligned tick table](aligned-ticks.csv): 12,002 rows, sorted by tick then seed, including tick zero. Population is saved every tick; family, food, and occupancy values are present every 20 ticks, including zero. Blank cells mean **unsampled**, not zero. No interpolation.
- [Aligned interval table](aligned-500-tick-windows.csv): 24 rows, sorted by endpoint then seed. All twelve non-overlapping 500-tick intervals per seed are included, with population minimum/mean/maximum/endpoint, endpoint families and band occupancy, deposited/overflow food, and food remaining.

Ticks 0–3,000 are the accepted historical prefixes, not new samples. Only ticks 3,001–6,000 are continuation evidence. One independently initialized exact repeat per seed verifies reproducibility; it is not an additional independent trajectory. Both source records preserve 301 samples/frames, 6,000 tick rows, and 13 snapshots. No simulation, new trajectory, food change, retry, or horizon extension was used for this analysis.

## Population durability

Each entry is **minimum / mean / endpoint**, over exactly 500 executed ticks.

| Interval | Seed 1203 | Seed 1202 |
| --- | ---: | ---: |
| 3,001–3,500 | 5 / 11.000 / 6 | 3 / 14.666 / 3 |
| 3,501–4,000 | 5 / 9.022 / 17 | 3 / 8.426 / 25 |
| 4,001–4,500 | 8 / 13.562 / 11 | 14 / 22.068 / 25 |
| 4,501–5,000 | 9 / 13.604 / 15 | 11 / 19.550 / 13 |
| 5,001–5,500 | 12 / 18.448 / 20 | 3 / 9.978 / 3 |
| 5,501–6,000 | 19 / 26.182 / 34 | 2 / 5.990 / 11 |

Seed 1203's earliest continuation minimum is five bodies at **3,357**. It first returns after that trough to its 16-body tick-3,000 population at **4,000**, then first reaches 32 at **5,600**. Its final 500-tick minimum is 19 despite the endpoint of 34.

Seed 1202's earliest continuation minimum is two at **5,589**, followed by a descriptive rise to eleven. It never subsequently regains its 34-body tick-3,000 population. Its post-3,000 attainment of 32 at **3,001** precedes the collapse and is not recovery.

Neither final-window mean reaches the separately frozen mean-at-least-32 sustained-population summary. Across the continuation, populations reach at least 32 on only **59/3,000 ticks for 1203** and **53/3,000 for 1202**. Endpoint counts therefore overstate persistent abundance. The descriptive trough-to-threshold timings do not establish sustained recovery or adaptation.

## Founder retention and occupied body tiles

Family counts retain the raw records' ordering: mint / gold / lilac. Band counts are occupied body tiles, not numbers of bodies or family-specific occupancy.

| Tick | 1203 families | 1203 bands 0/1 | 1202 families | 1202 bands 0/1 |
| --- | ---: | ---: | ---: | ---: |
| 3,000 | 0/9/7 | 42/218 | 15/0/19 | 113/406 |
| 3,500 | 0/1/5 | 86/24 | 1/0/2 | 50/24 |
| 4,000 | 0/10/7 | 85/128 | 17/0/8 | 109/181 |
| 4,500 | 0/6/5 | 85/76 | 6/0/19 | 282/80 |
| 5,000 | 0/10/5 | 73/181 | 12/0/1 | 15/190 |
| 5,500 | 0/7/13 | 258/126 | 3/0/0 | 0/59 |
| 6,000 | 0/28/6 | 75/371 | 11/0/0 | 0/131 |

Each seed already has only two founder families at 3,000. Seed 1203 retains both remaining families throughout the sampled continuation, although gold reaches just **one body**. Its endpoint has fifteen distinct programs; programs are not founder families. Both bands are positive at all **151 saved observations from 3,000 through 6,000**, but band 1 has only four occupied tiles at **3,540** and seven at **3,560**. Passing the two final ten-tile checkpoints does not establish uninterrupted occupancy above ten.

For 1202, lilac is first absent in saved samples at **5,060**, after being present at 5,040. Band 0 is empty at every saved observation from **5,060 through 6,000** (48 samples). The final eleven bodies belong to mint and contain two programs. Sampled loss times and occupancy do not establish exact loss ticks or continuous occupancy between observations.

## Seasonal persistence

The prescribed numerical pattern requires growth of at least 20 occupied tiles in the majority band and retreat of at least 20 in the minority band over a 500-tick interval. Majority bands alternate without resetting the schedule at 3,000.

| Late interval | Majority band | 1203 changes, bands 0/1 | 1202 changes, bands 0/1 |
| --- | ---: | ---: | ---: |
| 4,500→5,000 | 1 | −12/+105 — fail | −267/+110 — pass |
| 5,000→5,500 | 0 | +185/−55 — pass | −15/−131 — fail |
| 5,500→6,000 | 1 | −183/+245 — pass | 0/+72 — fail |

Across all six new intervals, this numerical pattern qualifies in **3/6 for 1203** (ending 3,500, 5,500, 6,000) and **2/6 for 1202** (ending 4,500, 5,000). These six-interval counts are retrospective descriptors, not additional frozen gates. Both pass the frozen requirement of at least one qualifying **late** interval, but repeated late seasonal response is not shared across both trajectories. Existing, explicitly non-blind body-only receipts confirm the same qualifying late intervals and own-world 5,500→6,000 change; this analysis does not conduct a new visual adjudication.

## Food observations

Every 500-tick interval offers **76,800** food units; the continuation offers **460,800** per seed. Accepted food is deposited supply, not consumption.

| Continuation interval | Accepted, 1203 / 1202 | Overflow, 1203 / 1202 |
| --- | ---: | ---: |
| 3,001–3,500 | 25,080 / 28,197 | 51,720 / 48,603 |
| 3,501–4,000 | 23,898 / 35,810 | 52,902 / 40,990 |
| 4,001–4,500 | 15,103 / 16,800 | 61,697 / 60,000 |
| 4,501–5,000 | 18,082 / 23,783 | 58,718 / 53,017 |
| 5,001–5,500 | 15,538 / 24,967 | 61,262 / 51,833 |
| 5,501–6,000 | 26,869 / 19,146 | 49,931 / 57,654 |
| Total | 124,570 / 148,703 | 336,230 / 312,097 |

At 3,000, food remaining is **177,205 / 162,288** (1203 / 1202); at 6,000 it is **172,916 / 202,473**. Thus more continuation deposition and more final food coexist with the poorer final diversity/spatial outcome in 1202. Global stocks include food outside occupied bodies' reach; neither stocks nor deposition establish accessible food sufficiency, intake, efficiency, or a causal explanation of the seed difference.

## Conclusions retained

- Across both selected seeds: survival to 6,000, deep population bottlenecks, positive births and deaths with zero cap-48 ticks in every continuation window, failure of the final-500 mean-at-least-32 summary, and at least one qualifying late seasonal interval.
- Specific to 1203: the late rebound to 34, retention of two remaining founder families, both bands positive at every saved continuation observation, and two consecutive qualifying final intervals.
- Specific to 1202: loss of lilac, sampled abandonment of band 0, a two-body late trough, and survival with one family and two programs.

The frozen outcome remains **1203 Promising at 6,000; 1202 valid Stop**. All four screens pass only for 1203; numerical family retention and final spatial occupancy fail for 1202. The initial 3,000-tick passes do not establish later durability. Neither trajectory establishes durable coexistence, adaptation, improved fitness, reliable superiority, learned migration, or causal superiority. Two selected trajectories and their exact repeats do not estimate an unbiased success rate. Historical conclusions, frozen thresholds, and stopping rules are unchanged: no automatic retry, tuning, additional seed, control, or extension follows this comparison.

## Recommendations for a separately authorized future plan

These are recommendations only, not adopted endpoints, amendments, new gates, or authorization to run. Any future experiment requires its own separately reviewed plan fixing definitions and thresholds before execution.

- **Abundance:** fix the horizon, window boundaries, means and minima, time below a chosen abundance threshold, recovery reference, required recovery duration, and treatment of non-recovery. Keep endpoint survival distinct from sustained abundance and coexistence.
- **Founder coexistence:** fix minimum family abundance, family balance, joint-retention duration, and observation cadence. Separate founder-family retention from program diversity and generation counts.
- **Space:** fix the occupied-tile threshold and cadence, fraction of observations meeting it, longest sampled failure interval, and requirements for joint family/band persistence. Specify whether finer observations are needed for continuous-time claims.
- **Seasonality:** fix the denominator, qualifying fraction, consecutive qualifying cycles, and treatment of minority-band absence, alongside any permissive gate. Record all intervals and retain the numerical/visual distinction.
- **Resources and inference:** distinguish offered, deposited, overflow, remaining, spatial accessibility, and actual uptake. Fix the seed-selection scheme, independent-trajectory count, and aggregation rules. Keep exact repeats as reproducibility checks.

## Validation

The tables were regenerated and checked solely against committed saved observations, including all 13 snapshot endpoints per seed; no model was imported or stepped. See [validation and independent review](REVIEW.md). Runtime tests are unnecessary for these documentation/data additions and were not run. No hosted CI success is claimed.
