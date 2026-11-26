# Prediction envelope v0: comparison

No model call, no GPU, no paid compute: every prediction is from a deterministic rule. This table says nothing about any model.

Protocol hash `ad924e6bf6caaf78f99e1785728657d5f4a02e2938fa9d5d847140230b8da3b0`. Primary readout: body mass (B+P); minimum effect 25 mass quanta. Strongest simple baseline on dev: **v0Rules**. Measurement-limited cases (label flips at 0.75x or 1.25x the threshold): 10, kept in every denominator of the first two tables.

### dev (96 cases, 16 families; up 13, down 26, none 57)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.556 | 0.556 | 0.594 | 0.333 | 0.594 | 0.406 |
| alwaysNone | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.813 | 0.813 | 0.594 | 0.333 | 0.594 | 0.406 |
| fixedRule | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.582 | 0.582 | 0.573 | 0.760 | 0.573 | 0.406 |
| numericTrend | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.680 | 0.680 | 0.271 | 0.298 | 0.271 | 0.406 |
| v0Rules | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.437 | 0.437 | 0.573 | 0.760 | 0.573 | 0.406 |
| shuffledEvidence | control | 96 | 0 | 0 | 0 | 1.000 | 0.681 | 0.681 | 0.260 | 0.338 | 0.260 | 0.406 |
| abstainAll | baseline | 0 | 96 | 0 | 0 | 0.000 | 0.556 | n/a | n/a | n/a | n/a | 0.000 |
| mechanismRule | oracle | 96 | 0 | 0 | 0 | 1.000 | 0.284 | 0.284 | 0.865 | 0.884 | 0.865 | 0.406 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 155.1; freeNutrient (nutrient quanta, diagnostic) 9923.5; livingCells (cells, diagnostic) 5.3.

### test (96 cases, 16 families; up 12, down 27, none 57)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.553 | 0.553 | 0.594 | 0.333 | 0.594 | 0.406 |
| alwaysNone | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.813 | 0.813 | 0.594 | 0.333 | 0.594 | 0.406 |
| fixedRule | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.582 | 0.582 | 0.573 | 0.760 | 0.573 | 0.406 |
| numericTrend | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.704 | 0.704 | 0.219 | 0.259 | 0.219 | 0.406 |
| v0Rules | baseline | 96 | 0 | 0 | 0 | 1.000 | 0.437 | 0.437 | 0.573 | 0.760 | 0.573 | 0.406 |
| shuffledEvidence | control | 96 | 0 | 0 | 0 | 1.000 | 0.690 | 0.690 | 0.240 | 0.346 | 0.240 | 0.406 |
| abstainAll | baseline | 0 | 96 | 0 | 0 | 0.000 | 0.553 | n/a | n/a | n/a | n/a | 0.000 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 199.7; freeNutrient (nutrient quanta, diagnostic) 9953.5; livingCells (cells, diagnostic) 6.1.

### test, measurement-limited cases excluded (90 cases, 16 families; up 12, down 25, none 53)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 90 | 0 | 0 | 0 | 1.000 | 0.558 | 0.558 | 0.589 | 0.333 | 0.589 | 0.411 |
| alwaysNone | baseline | 90 | 0 | 0 | 0 | 1.000 | 0.822 | 0.822 | 0.589 | 0.333 | 0.589 | 0.411 |
| fixedRule | baseline | 90 | 0 | 0 | 0 | 1.000 | 0.569 | 0.569 | 0.589 | 0.767 | 0.589 | 0.411 |
| numericTrend | baseline | 90 | 0 | 0 | 0 | 1.000 | 0.704 | 0.704 | 0.222 | 0.267 | 0.222 | 0.411 |
| v0Rules | baseline | 90 | 0 | 0 | 0 | 1.000 | 0.428 | 0.428 | 0.589 | 0.767 | 0.589 | 0.411 |
| shuffledEvidence | control | 90 | 0 | 0 | 0 | 1.000 | 0.696 | 0.696 | 0.233 | 0.338 | 0.233 | 0.411 |
| abstainAll | baseline | 0 | 90 | 0 | 0 | 0.000 | 0.558 | n/a | n/a | n/a | n/a | 0.000 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 211.4; freeNutrient (nutrient quanta, diagnostic) 10557.4; livingCells (cells, diagnostic) 6.4.

## Family-level intervals (imputed Brier, whole-family bootstrap)

- dev: intervals computed
  - abstainAll: 0.556 [0.495, 0.617]
  - alwaysNone: 0.813 [0.667, 0.958]
  - fixedRule: 0.582 [0.523, 0.640]
  - numericTrend: 0.680 [0.627, 0.721]
  - priorMajority: 0.556 [0.495, 0.617]
  - shuffledEvidence: 0.681 [0.654, 0.709]
  - v0Rules: 0.438 [0.408, 0.467]
  - abstainAll minus v0Rules: 0.118 [0.028, 0.209]
  - alwaysNone minus v0Rules: 0.375 [0.200, 0.550]
  - fixedRule minus v0Rules: 0.144 [0.115, 0.173]
  - numericTrend minus v0Rules: 0.243 [0.176, 0.293]
  - priorMajority minus v0Rules: 0.118 [0.028, 0.209]
  - shuffledEvidence minus v0Rules: 0.244 [0.196, 0.294]
- test: intervals computed
  - abstainAll: 0.553 [0.507, 0.595]
  - alwaysNone: 0.813 [0.688, 0.917]
  - fixedRule: 0.582 [0.540, 0.632]
  - numericTrend: 0.704 [0.677, 0.735]
  - priorMajority: 0.553 [0.507, 0.595]
  - shuffledEvidence: 0.690 [0.662, 0.720]
  - v0Rules: 0.438 [0.417, 0.463]
  - abstainAll minus v0Rules: 0.115 [0.044, 0.178]
  - alwaysNone minus v0Rules: 0.375 [0.225, 0.500]
  - fixedRule minus v0Rules: 0.144 [0.123, 0.169]
  - numericTrend minus v0Rules: 0.267 [0.251, 0.288]
  - priorMajority minus v0Rules: 0.115 [0.044, 0.178]
  - shuffledEvidence minus v0Rules: 0.252 [0.208, 0.298]

## Mechanism audit (measured vs fixture expectation)

| mechanism | expected | up | down | none |
|---|---|---|---|---|
| feedOccupied | up | 23 | 0 | 9 |
| lesionOccupied | down | 0 | 32 | 0 |
| drainOccupied | down | 0 | 21 | 11 |
| sham | none | 0 | 0 | 32 |
| lesionEmpty | none | 0 | 0 | 32 |
| lowDoseFeed | none | 2 | 0 | 30 |

## File-level diagnostics (per proposer, over the envelopes it was meant to answer)

| proposer | lines | invalid | missing | extra | duplicates | not an object | unsound envelopes |
|---|---|---|---|---|---|---|---|
| abstainAll | 192 | 0 | 0 | 0 | 0 | 0 | 0 |
| alwaysNone | 192 | 0 | 0 | 0 | 0 | 0 | 0 |
| fixedRule | 192 | 0 | 0 | 0 | 0 | 0 | 0 |
| mechanismRule | 96 | 0 | 0 | 0 | 0 | 0 | 0 |
| numericTrend | 192 | 0 | 0 | 0 | 0 | 0 | 0 |
| priorMajority | 192 | 0 | 0 | 0 | 0 | 0 | 0 |
| shuffledEvidence | 192 | 0 | 0 | 0 | 0 | 0 | 0 |
| v0Rules | 192 | 0 | 0 | 0 | 0 | 0 | 0 |

## Predicted class on the test split (answered cases)

| proposer | up | down | none |
|---|---|---|---|
| abstainAll | 0 | 0 | 0 |
| alwaysNone | 0 | 0 | 96 |
| fixedRule | 32 | 48 | 16 |
| numericTrend | 24 | 72 | 0 |
| priorMajority | 0 | 0 | 96 |
| shuffledEvidence | 24 | 72 | 0 |
| v0Rules | 32 | 48 | 16 |

## Trend-confound diagnostic

Share of cases labelled up by the paired rule (treated minus control) vs the naive before/after rule (treated minus value at the fork); an always-rising predictor is right exactly when its rule says up.

- share of cases labelled up: paired rule 0.130, naive before/after rule 0.182; cases with treated above the fork value: 35/192
- sham: 32 cases, naive rule says up on 7, paired rule says none on 32
- low-dose feed: 32 cases, naive rule says up on 7, paired rule says none on 30
- intended-null cases (sham and low-dose feed; paired outcome is none on most, not all), all splits: 64 cases, 14 with treated above the fork value; naive before/after rule says up on 14; numericTrend predicts up on 14; paired outcome is none on 62; the before/after rule, numericTrend and a paired outcome of none coincide on 14

## Cost and stability

- total evaluation cost 125337600 cell-steps; cost per non-null case 1606892
- cross-seed effect stability (qualify families, sibling seed): 22/24 labels agree (0.917); heterogeneity across seeds of one family, not a predictor's accuracy limit

- the strongest simple baseline is whichever of priorMajority, alwaysNone, fixedRule, numericTrend, v0Rules scores best on dev; a calibrated majority is legitimately strong
- shuffledEvidence is a control, mechanismRule a dev-only oracle (run on dev cases only), abstainAll a coverage floor
- degenerate on the test split, one predicted class for every answered case: priorMajority (all none), alwaysNone (all none); a degenerate row cannot show the harness separating an evidence-using rule from its shuffled control (test: tools/test/prediction-proposers.test.ts, opposite-trend envelopes)
