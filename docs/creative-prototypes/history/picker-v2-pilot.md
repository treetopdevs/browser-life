# World picker scripted pilot

Seeds 1201–1203, three rounds of 1,000 ticks, three candidates per round: 27 candidate runs. Chosen slots were fixed in advance at **1, 2, 0** (zero-based). This exercises selection and ancestry; it is not a fitness search or a claim about human preferences. Organism mutation was enabled. Runtime v24.2.0, toy rules version 2.

| Seed | Round | Final populations, slots 0 / 1 / 2 | Final mean speeds | Occupied bins / 100 | Chosen slot |
|---|---:|---|---|---|---:|
| 1201 | 1 | 149 / 174 / 171 | 0.002639 / 0.000348 / 0.000532 | 64 / 15 / 34 | 1 |
| 1201 | 2 | 174 / 99 / 170 | 0.000348 / 0.000450 / 0.000421 | 15 / 10 / 14 | 2 |
| 1201 | 3 | 170 / 170 / 239 | 0.000421 / 0.000349 / 0.000470 | 14 / 13 / 20 | 0 |
| 1202 | 1 | 151 / 185 / 184 | 0.001982 / 0.000252 / 0.000615 | 46 / 16 / 34 | 1 |
| 1202 | 2 | 185 / 145 / 185 | 0.000252 / 0.000479 / 0.000303 | 16 / 13 / 16 | 2 |
| 1202 | 3 | 185 / 186 / 183 | 0.000303 / 0.000284 / 0.000392 | 16 / 14 / 16 | 0 |
| 1203 | 1 | 152 / 155 / 179 | 0.002443 / 0.000291 / 0.000517 | 61 / 14 / 29 | 1 |
| 1203 | 2 | 155 / 174 / 168 | 0.000291 / 0.000306 / 0.000690 | 14 / 16 / 13 | 2 |
| 1203 | 3 | 168 / 113 / 84 | 0.000690 / 0.000498 / 0.001101 | 13 / 9 / 6 | 0 |

## What happened

All 27 candidates remained alive through tick 1,000. Round one compares pursuit, flocks and colonies; the fixed first pick selects flocks. Later rounds compare that kept recipe with two small inherited recipe variations. Some changes barely affect these observations (seed 1201, round three, slots 0 and 1 both finish at 170), while others yield clear differences (seed 1203, round three: populations 168, 113 and 84). Equality of a population count does not imply identical trajectories.

The script verifies that each kept recipe is preserved exactly and every serialized selection history round-trips. Every round restarts at the same seed and tick zero. Its final-tick speeds and occupied bins describe movement and concentration; they do not measure adaptation or establish which world is worth watching. The separate browser recording supplies visual evidence. Survival through 1,000 ticks is not a long-term persistence claim.

## Compatibility and provenance

The regenerated default nine-run pilot was compared with archived [version 1 evidence](history/particle-v1-pilot.json). Every numerical census, final result and ledger value matched exactly across 279 censuses; the complete JSON objects differ only in model source hash and rules version (1 → 2). The recipe extension therefore preserves the recorded default trajectories. This is same-runtime evidence, not cross-browser bitwise assurance.

Source SHA-256 values for this picker run:

- model.ts: `b30a8b83a2cf7d26e7d673478c108606abf140f32401f4f646d35c067e9c53fd`
- comparison.ts: `6f19b72599b614e46be571d16fc8cc1cc4479890bff86c2ad08b2072fdaf9f34`

[Full observations, recipes and selection histories](picker-pilot.json). Reproduce with Node 24: `node tools/particles/explore-picker.ts`. Picker evidence freshness: `node tools/particles/explore-picker.ts --check`. Default evidence freshness: `node tools/particles/explore.ts --check`.
