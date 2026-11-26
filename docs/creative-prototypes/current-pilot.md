# Nutrient current pilot evidence

Generated fixed evidence from 24.2.0 on darwin/arm64. The engineered current permutes nutrient only every fourth tick on the fixed paired-column conveyor. Its circulated counter records total nutrient translated at each pulse; it is not net delivery. Rain is added before a same-tick current pulse. All four conditions share seeded initial stocks and phases, and all worlds continue through tick 6000 after extinction.

The batch retains three seeds and every outcome. Censuses are stored every 50 ticks plus exact extinction, snapshots at 0, 1000, 3000, 4095, 4096, 6000, and replay frames only at the exact ticks listed in JSON. No frame interpolation is used as physical evidence. Current-off worlds were compared against the original matter stepper through tick 6000 at every 100 ticks and at the endpoint. Repeated current-model states were compared in full at every 100 ticks and at the endpoint.

Samples show sampled peak biomass and endpoint activity; late counter deltas are cumulative changes from tick 5000 through 6000. Biomass endpoint difference can hide turnover between observations. Nutrient unit-moves and translated nutrient units do not establish useful supply or growth. Rain exhausts at tick 4096 under the fixed source schedule. No survival benefit or adaptation claim is made.

| Seed | Condition | Extinction | Sampled peak | Endpoint biomass / active cells | First physical divergence from still sibling | First biomass divergence | First rain/closed divergence | Late counter deltas (5000–6000) |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1201 | closed-still | 790 | 792 @ 100 | 0 / 0 | none | none | none | {"growth":0,"mortality":0,"recycled":0,"relaxed":0,"circulated":0} |
| 1201 | closed-current | alive at 6000 | 10755 @ 500 | 469 / 33 | 4 | 33 | none | {"growth":4695,"mortality":4748,"recycled":4843,"relaxed":99,"circulated":168255} |
| 1201 | rain-still | 790 | 792 @ 100 | 0 / 0 | none | none | 8 | {"growth":0,"mortality":0,"recycled":0,"relaxed":0,"circulated":0} |
| 1201 | rain-current | alive at 6000 | 12624 @ 550 | 471 / 34 | 4 | 33 | 8 | {"growth":6092,"mortality":6725,"recycled":5891,"relaxed":322,"circulated":192101} |
| 1202 | closed-still | 1000 | 927 @ 100 | 0 / 0 | none | none | none | {"growth":0,"mortality":0,"recycled":0,"relaxed":0,"circulated":0} |
| 1202 | closed-current | alive at 6000 | 10617 @ 500 | 494 / 35 | 4 | 31 | none | {"growth":4884,"mortality":4928,"recycled":4943,"relaxed":114,"circulated":166280} |
| 1202 | rain-still | 1000 | 927 @ 100 | 0 / 0 | none | none | 8 | {"growth":0,"mortality":0,"recycled":0,"relaxed":0,"circulated":0} |
| 1202 | rain-current | alive at 6000 | 12918 @ 500 | 489 / 36 | 4 | 31 | 8 | {"growth":6221,"mortality":6886,"recycled":5955,"relaxed":295,"circulated":196294} |
| 1203 | closed-still | 790 | 834 @ 100 | 0 / 0 | none | none | none | {"growth":0,"mortality":0,"recycled":0,"relaxed":0,"circulated":0} |
| 1203 | closed-current | alive at 6000 | 10642 @ 500 | 496 / 35 | 4 | 33 | none | {"growth":4751,"mortality":4764,"recycled":4872,"relaxed":112,"circulated":172683} |
| 1203 | rain-still | 790 | 834 @ 100 | 0 / 0 | none | none | 8 | {"growth":0,"mortality":0,"recycled":0,"relaxed":0,"circulated":0} |
| 1203 | rain-current | alive at 6000 | 12730 @ 550 | 489 / 36 | 4 | 33 | 8 | {"growth":5913,"mortality":6490,"recycled":5705,"relaxed":307,"circulated":190104} |

Replay assets: currents-replay-1201.replay, currents-replay-1202.replay, currents-replay-1203.replay. Source SHA-256 values and replay asset hashes are in the JSON manifest. Run node tools/currents/explore.ts --check to verify the source freeze, matrix, snapshots, ledgers, summaries, replay hashes and this report. Run --replay-check to rerun the exact fixed batch and compare every retained outcome.
