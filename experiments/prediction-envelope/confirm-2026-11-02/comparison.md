# Prediction envelope v0: comparison

No model call, no GPU, no paid compute: every prediction is from a deterministic rule. This table says nothing about any model.

Protocol hash `07dbf7333dcfc6d150c51a1071ef4f9c9616fa9bf32beec5d1187ff256bf620b`. Primary readout: body mass (B+P); minimum effect 25 mass quanta. Strongest simple baseline on dev: **v0Rules**. Measurement-limited cases (label flips at 0.75x or 1.25x the threshold): 4, kept in every denominator of the first two tables.

### dev (24 cases, 4 families; up 3, down 5, none 16)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 24 | 0 | 0 | 0 | 1.000 | 0.506 | 0.506 | 0.667 | 0.333 | 0.667 | 0.333 |
| alwaysNone | baseline | 24 | 0 | 0 | 0 | 1.000 | 0.667 | 0.667 | 0.667 | 0.333 | 0.667 | 0.333 |
| fixedRule | baseline | 24 | 0 | 0 | 0 | 1.000 | 0.640 | 0.640 | 0.500 | 0.750 | 0.500 | 0.333 |
| numericTrend | baseline | 24 | 0 | 0 | 0 | 1.000 | 0.615 | 0.615 | 0.375 | 0.371 | 0.375 | 0.333 |
| v0Rules | baseline | 24 | 0 | 0 | 0 | 1.000 | 0.467 | 0.467 | 0.500 | 0.750 | 0.500 | 0.333 |
| shuffledEvidence | control | 24 | 0 | 0 | 0 | 1.000 | 0.631 | 0.631 | 0.333 | 0.350 | 0.333 | 0.333 |
| abstainAll | baseline | 0 | 24 | 0 | 0 | 0.000 | 0.506 | n/a | n/a | n/a | n/a | 0.000 |
| mechanismRule | oracle | 24 | 0 | 0 | 0 | 1.000 | 0.318 | 0.318 | 0.833 | 0.917 | 0.833 | 0.333 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 116.9; freeNutrient (nutrient quanta, diagnostic) 9907.9; livingCells (cells, diagnostic) 5.1.

### test (96 cases, 16 families; up 12, down 27, none 57)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.553 | 0.553 | 0.594 | 0.333 | 0.594 | 0.406 |
| alwaysNone | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.813 | 0.813 | 0.594 | 0.333 | 0.594 | 0.406 |
| fixedRule | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.582 | 0.582 | 0.573 | 0.760 | 0.573 | 0.406 |
| numericTrend | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.690 | 0.690 | 0.240 | 0.284 | 0.240 | 0.406 |
| v0Rules | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.437 | 0.437 | 0.573 | 0.760 | 0.573 | 0.406 |
| shuffledEvidence | control | 96 | 0 | 0 | 0 | 1.000 | 0.683 | 0.683 | 0.250 | 0.343 | 0.250 | 0.406 |
| abstainAll | baseline | 0 | 96 | 0 | 0 | 0.000 | 0.553 | n/a | n/a | n/a | n/a | 0.000 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 174.6; freeNutrient (nutrient quanta, diagnostic) 9903.8; livingCells (cells, diagnostic) 4.9.

### test, measurement-limited cases excluded (92 cases, 16 families; up 11, down 25, none 56)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 92 | 0 | 0 | 0 | 1.000 | 0.542 | 0.542 | 0.609 | 0.333 | 0.609 | 0.391 |
| alwaysNone | baseline | 92 | 0 | 0 | 0 | 1.000 | 0.783 | 0.783 | 0.609 | 0.333 | 0.609 | 0.391 |
| fixedRule | baseline | 92 | 0 | 0 | 0 | 1.000 | 0.588 | 0.588 | 0.565 | 0.762 | 0.565 | 0.391 |
| numericTrend | baseline | 92 | 0 | 0 | 0 | 1.000 | 0.692 | 0.692 | 0.228 | 0.280 | 0.228 | 0.391 |
| v0Rules | baseline | 92 | 0 | 0 | 0 | 1.000 | 0.438 | 0.438 | 0.565 | 0.762 | 0.565 | 0.391 |
| shuffledEvidence | control | 92 | 0 | 0 | 0 | 1.000 | 0.677 | 0.677 | 0.250 | 0.358 | 0.250 | 0.391 |
| abstainAll | baseline | 0 | 92 | 0 | 0 | 0.000 | 0.542 | n/a | n/a | n/a | n/a | 0.000 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 181.0; freeNutrient (nutrient quanta, diagnostic) 9704.1; livingCells (cells, diagnostic) 5.2.

## Family-level intervals (imputed Brier, whole-family bootstrap)

- dev: descriptive only (fewer than 10 families)
- test: intervals computed
  - abstainAll: 0.553 [0.501, 0.602]
  - alwaysNone: 0.813 [0.687, 0.938]
  - fixedRule: 0.582 [0.532, 0.632]
  - numericTrend: 0.690 [0.668, 0.716]
  - priorMajority: 0.553 [0.501, 0.602]
  - shuffledEvidence: 0.683 [0.659, 0.709]
  - v0Rules: 0.438 [0.413, 0.463]
  - abstainAll minus v0Rules: 0.115 [0.036, 0.189]
  - alwaysNone minus v0Rules: 0.375 [0.225, 0.525]
  - fixedRule minus v0Rules: 0.144 [0.119, 0.169]
  - numericTrend minus v0Rules: 0.252 [0.229, 0.273]
  - priorMajority minus v0Rules: 0.115 [0.036, 0.189]
  - shuffledEvidence minus v0Rules: 0.245 [0.202, 0.289]

## Mechanism audit (measured vs fixture expectation)

| mechanism | expected | up | down | none |
|---|---|---|---|---|
| feedOccupied | up | 15 | 0 | 5 |
| lesionOccupied | down | 0 | 20 | 0 |
| drainOccupied | down | 0 | 12 | 8 |
| sham | none | 0 | 0 | 20 |
| lesionEmpty | none | 0 | 0 | 20 |
| lowDoseFeed | none | 0 | 0 | 20 |

## File-level diagnostics (per proposer, over the envelopes it was meant to answer)

| proposer | lines | invalid | missing | extra | duplicates | not an object | unsound envelopes |
|---|---|---|---|---|---|---|---|
| abstainAll | 120 | 0 | 0 | 0 | 0 | 0 | 0 |
| alwaysNone | 120 | 0 | 0 | 0 | 0 | 0 | 0 |
| fixedRule | 120 | 0 | 0 | 0 | 0 | 0 | 0 |
| mechanismRule | 24 | 0 | 0 | 0 | 0 | 0 | 0 |
| numericTrend | 120 | 0 | 0 | 0 | 0 | 0 | 0 |
| priorMajority | 120 | 0 | 0 | 0 | 0 | 0 | 0 |
| shuffledEvidence | 120 | 0 | 0 | 0 | 0 | 0 | 0 |
| v0Rules | 120 | 0 | 0 | 0 | 0 | 0 | 0 |

## Predicted class on the test split (answered cases)

| proposer | up | down | none |
|---|---|---|---|
| abstainAll | 0 | 0 | 0 |
| alwaysNone | 0 | 0 | 96 |
| fixedRule | 32 | 48 | 16 |
| numericTrend | 18 | 78 | 0 |
| priorMajority | 0 | 0 | 96 |
| shuffledEvidence | 18 | 78 | 0 |
| v0Rules | 32 | 48 | 16 |

## Trend-confound diagnostic

Share of cases labelled up by the paired rule (treated minus control) vs the naive before/after rule (treated minus value at the fork); an always-rising predictor is right exactly when its rule says up.

- share of cases labelled up: paired rule 0.125, naive before/after rule 0.175; cases with treated above the fork value: 23/120
- sham: 20 cases, naive rule says up on 4, paired rule says none on 20
- low-dose feed: 20 cases, naive rule says up on 4, paired rule says none on 20
- intended-null cases (sham and low-dose feed; paired outcome is none on most, not all), all splits: 40 cases, 8 with treated above the fork value; naive before/after rule says up on 8; numericTrend predicts up on 6; paired outcome is none on 40; the before/after rule, numericTrend and a paired outcome of none coincide on 6

## Cost and stability

- total evaluation cost 69632000 cell-steps; cost per non-null case 1481532
- cross-seed effect stability (qualify families, sibling seed): 0/0 labels agree (n/a); heterogeneity across seeds of one family, not a predictor's accuracy limit

- the dev split has fewer than 10 families: descriptive only (no intervals)
- the strongest simple baseline is whichever of priorMajority, alwaysNone, fixedRule, numericTrend, v0Rules scores best on dev; a calibrated majority is legitimately strong
- shuffledEvidence is a control, mechanismRule a dev-only oracle (run on dev cases only), abstainAll a coverage floor
- degenerate on the test split, one predicted class for every answered case: priorMajority (all none), alwaysNone (all none); a degenerate row cannot show the harness separating an evidence-using rule from its shuffled control (test: tools/test/prediction-proposers.test.ts, opposite-trend envelopes)
