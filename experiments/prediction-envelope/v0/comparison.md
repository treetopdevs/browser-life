# Prediction envelope v0: comparison

No model call, no GPU, no paid compute: every prediction is from a deterministic rule. This table says nothing about any model.

Protocol hash `dcbb2b2b702e1aa60cf98727c0daa4537a4c234ff68b3636a010d2d724ae6ac8`. Primary readout: body mass (B+P); minimum effect 25 mass quanta. Strongest simple baseline on dev: **v0Rules**. Measurement-limited cases (label flips at 0.75x or 1.25x the threshold): 8, kept in every denominator of the first two tables.

### dev (72 cases, 12 families; up 13, down 21, none 38)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.604 | 0.604 | 0.528 | 0.333 | 0.528 | 0.472 |
| alwaysNone | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.944 | 0.944 | 0.528 | 0.333 | 0.528 | 0.472 |
| fixedRule | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.529 | 0.529 | 0.639 | 0.772 | 0.639 | 0.472 |
| numericTrend | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.680 | 0.680 | 0.292 | 0.333 | 0.292 | 0.472 |
| v0Rules | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.411 | 0.411 | 0.639 | 0.772 | 0.639 | 0.472 |
| shuffledEvidence | control | 72 | 0 | 0 | 0 | 1.000 | 0.680 | 0.680 | 0.292 | 0.333 | 0.292 | 0.472 |
| abstainAll | baseline | 0 | 72 | 0 | 0 | 0.000 | 0.604 | n/a | n/a | n/a | n/a | 0.000 |
| mechanismRule | oracle | 72 | 0 | 0 | 0 | 1.000 | 0.227 | 0.227 | 0.917 | 0.914 | 0.917 | 0.472 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 139.3; freeNutrient (nutrient quanta, diagnostic) 9671.2; livingCells (cells, diagnostic) 5.1.

### test (72 cases, 12 families; up 12, down 21, none 39)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.594 | 0.594 | 0.542 | 0.333 | 0.542 | 0.458 |
| alwaysNone | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.917 | 0.917 | 0.542 | 0.333 | 0.542 | 0.458 |
| fixedRule | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.540 | 0.540 | 0.625 | 0.769 | 0.625 | 0.458 |
| numericTrend | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.674 | 0.674 | 0.292 | 0.333 | 0.292 | 0.458 |
| v0Rules | baseline | 72 | 0 | 0 | 0 | 1.000 | 0.417 | 0.417 | 0.625 | 0.769 | 0.625 | 0.458 |
| shuffledEvidence | control | 72 | 0 | 0 | 0 | 1.000 | 0.674 | 0.674 | 0.292 | 0.333 | 0.292 | 0.458 |
| abstainAll | baseline | 0 | 72 | 0 | 0 | 0.000 | 0.594 | n/a | n/a | n/a | n/a | 0.000 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 151.5; freeNutrient (nutrient quanta, diagnostic) 9673.1; livingCells (cells, diagnostic) 5.5.

### test, measurement-limited cases excluded (67 cases, 12 families; up 12, down 20, none 35)

| proposer | role | answered | abstained | invalid | missing | coverage | Brier (imputed) | Brier (answered) | direction acc. | balanced acc. | acc. at matched coverage | valid non-null yield |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| priorMajority | baseline | 67 | 0 | 0 | 0 | 1.000 | 0.606 | 0.606 | 0.522 | 0.333 | 0.522 | 0.478 |
| alwaysNone | baseline | 67 | 0 | 0 | 0 | 1.000 | 0.955 | 0.955 | 0.522 | 0.333 | 0.522 | 0.478 |
| fixedRule | baseline | 67 | 0 | 0 | 0 | 1.000 | 0.515 | 0.515 | 0.657 | 0.781 | 0.657 | 0.478 |
| numericTrend | baseline | 67 | 0 | 0 | 0 | 1.000 | 0.677 | 0.677 | 0.299 | 0.333 | 0.299 | 0.478 |
| v0Rules | baseline | 67 | 0 | 0 | 0 | 1.000 | 0.400 | 0.400 | 0.657 | 0.781 | 0.657 | 0.478 |
| shuffledEvidence | control | 67 | 0 | 0 | 0 | 1.000 | 0.677 | 0.677 | 0.299 | 0.333 | 0.299 | 0.478 |
| abstainAll | baseline | 0 | 67 | 0 | 0 | 0.000 | 0.606 | n/a | n/a | n/a | n/a | 0.000 |

Mean absolute effect: bodyMass (mass quanta (B+P)) 161.1; freeNutrient (nutrient quanta, diagnostic) 10389.4; livingCells (cells, diagnostic) 5.9.

## Family-level intervals (imputed Brier, whole-family bootstrap)

- dev: intervals computed
  - abstainAll: 0.604 [0.568, 0.646]
  - alwaysNone: 0.944 [0.833, 1.083]
  - fixedRule: 0.529 [0.473, 0.573]
  - numericTrend: 0.680 [0.659, 0.701]
  - priorMajority: 0.604 [0.568, 0.646]
  - shuffledEvidence: 0.680 [0.659, 0.701]
  - v0Rules: 0.411 [0.383, 0.433]
  - abstainAll minus v0Rules: 0.193 [0.132, 0.263]
  - alwaysNone minus v0Rules: 0.533 [0.400, 0.700]
  - fixedRule minus v0Rules: 0.118 [0.090, 0.140]
  - numericTrend minus v0Rules: 0.269 [0.234, 0.306]
  - priorMajority minus v0Rules: 0.193 [0.132, 0.263]
  - shuffledEvidence minus v0Rules: 0.269 [0.234, 0.306]
- test: intervals computed
  - abstainAll: 0.594 [0.574, 0.607]
  - alwaysNone: 0.917 [0.833, 0.972]
  - fixedRule: 0.540 [0.518, 0.573]
  - numericTrend: 0.674 [0.666, 0.687]
  - priorMajority: 0.594 [0.574, 0.607]
  - shuffledEvidence: 0.674 [0.666, 0.687]
  - v0Rules: 0.417 [0.406, 0.433]
  - abstainAll minus v0Rules: 0.177 [0.141, 0.202]
  - alwaysNone minus v0Rules: 0.500 [0.400, 0.567]
  - fixedRule minus v0Rules: 0.123 [0.112, 0.140]
  - numericTrend minus v0Rules: 0.258 [0.253, 0.260]
  - priorMajority minus v0Rules: 0.177 [0.141, 0.202]
  - shuffledEvidence minus v0Rules: 0.258 [0.253, 0.260]

## Mechanism audit (measured vs fixture expectation)

| mechanism | expected | up | down | none |
|---|---|---|---|---|
| feedOccupied | up | 23 | 0 | 1 |
| lesionOccupied | down | 0 | 24 | 0 |
| drainOccupied | down | 0 | 18 | 6 |
| sham | none | 0 | 0 | 24 |
| lesionEmpty | none | 0 | 0 | 24 |
| lowDoseFeed | none | 2 | 0 | 22 |

## File-level diagnostics (per proposer, over the envelopes it was meant to answer)

| proposer | lines | invalid | missing | extra | duplicates | not an object | unsound envelopes |
|---|---|---|---|---|---|---|---|
| abstainAll | 144 | 0 | 0 | 0 | 0 | 0 | 0 |
| alwaysNone | 144 | 0 | 0 | 0 | 0 | 0 | 0 |
| fixedRule | 144 | 0 | 0 | 0 | 0 | 0 | 0 |
| mechanismRule | 72 | 0 | 0 | 0 | 0 | 0 | 0 |
| numericTrend | 144 | 0 | 0 | 0 | 0 | 0 | 0 |
| priorMajority | 144 | 0 | 0 | 0 | 0 | 0 | 0 |
| shuffledEvidence | 144 | 0 | 0 | 0 | 0 | 0 | 0 |
| v0Rules | 144 | 0 | 0 | 0 | 0 | 0 | 0 |

## Predicted class on the test split (answered cases)

| proposer | up | down | none |
|---|---|---|---|
| abstainAll | 0 | 0 | 0 |
| alwaysNone | 0 | 0 | 72 |
| fixedRule | 24 | 36 | 12 |
| numericTrend | 0 | 72 | 0 |
| priorMajority | 0 | 0 | 72 |
| shuffledEvidence | 0 | 72 | 0 |
| v0Rules | 24 | 36 | 12 |

## Trend-confound diagnostic

Share of cases labelled up by the paired rule (treated minus control) vs the naive before/after rule (treated minus value at the fork); an always-rising predictor is right exactly when its rule says up.

- share of cases labelled up: paired rule 0.174, naive before/after rule 0.000; cases with treated above the fork value: 0/144
- sham: 24 cases, naive rule says up on 0, paired rule says none on 24
- low-dose feed: 24 cases, naive rule says up on 0, paired rule says none on 22

## Cost and stability

- total evaluation cost 97484800 cell-steps; cost per non-null case 1454997
- cross-seed effect stability (qualify families, sibling seed): 22/24 labels agree (0.917); heterogeneity across seeds of one family, not a predictor's accuracy limit

- the strongest simple baseline is whichever of priorMajority, alwaysNone, fixedRule, numericTrend, v0Rules scores best on dev; a calibrated majority is legitimately strong
- shuffledEvidence is a control, mechanismRule a dev-only oracle (run on dev cases only), abstainAll a coverage floor
- degenerate on the test split, one predicted class for every answered case: priorMajority (all none), alwaysNone (all none), numericTrend (all down), shuffledEvidence (all down); a degenerate row cannot show the harness separating an evidence-using rule from its shuffled control (test: tools/test/prediction-proposers.test.ts, opposite-trend envelopes)
- no fixture case has a treated value above its fork value, so these fixtures cannot demonstrate the before/after trend confound (the confound rule is tested on a synthetic rising set)
