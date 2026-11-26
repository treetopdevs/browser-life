# I02b result: held-out confirmation of the prediction envelope

Freeze commit (amendment, confirm protocol, freeze hash, code; pushed before the run): `1a69e9e8a21096bfcd6b7390b66234638f3ece4b`.
Attempt of record: one run, `experiments/prediction-envelope/confirm-2026-11-02/`, started from a clean closure at that commit
(`meta.json`: `status: CONFIRM`, `gitDirty: false`, 20 families, 120 cases, 216 s on an M1 Max). No rerun was made. CPU only; no model call, GPU, network or paid compute.
Protocol hash `07dbf7333dcfc6d150c51a1071ef4f9c9616fa9bf32beec5d1187ff256bf620b`. Rules: `AMENDMENT.md` section 4, applied by `confirmReading` on `ledger.jsonl`.

## Reading: NEGATIVE

Basis: rule 4b, a primary interval lies wholly above 0. No override fired (16 test families, 96 cases, pairing complete, no invalid or missing predictions,
measurement-limited share 4.2%, provenance verified). `numericTrend` predicts two or more classes, so it is not degenerate.

## Failed predictions first

`numericTrend` (the primary rule) was wrong on **73 of 96** test cases. Every one of the 16 test families has at least 4 failures (c15, c16, c17: 6 each).

| observed | predicted | cases |
|---|---|---|
| none | down | 43 |
| none | up | 14 |
| up | down | 12 |
| down | up | 4 |

It predicted `down` on 78 cases, `up` on 18 and `none` on none. 57 of the 96 test cases are observed `none`, so the dominant failure is calling a change where the
body-mass readout did not move by the 25-quanta minimum effect. The full list is in `confirmation.json` (`failedPredictions`) and at the top of `report.html`.

## Numbers (test split, 16 families, 96 cases; imputed multiclass Brier, lower is better)

| proposer | role in this reading | Brier | directional accuracy | predicted classes (down/none/up) |
|---|---|---|---|---|
| numericTrend | primary rule | 0.690 | 0.240 | 78 / 0 / 18 |
| shuffledEvidence | primary comparator (A) | 0.683 | 0.250 | 78 / 0 / 18 |
| priorMajority | primary comparator (B) | 0.553 | 0.594 | 0 / 96 / 0 |
| v0Rules | descriptive | 0.437 | 0.573 | 48 / 16 / 32 |
| fixedRule | descriptive | 0.582 | 0.573 | 48 / 16 / 32 |
| alwaysNone | descriptive | 0.813 | 0.594 | 0 / 96 / 0 |
| abstainAll | descriptive | 0.553 | n/a | all abstained |

Primary comparisons, paired whole-family bootstrap of the Brier difference (`numericTrend` minus comparator), 2000 resamples, seed 20261101, 95% percentile interval:

| comparison | mean difference | interval | position |
|---|---|---|---|
| (A) vs `shuffledEvidence` | +0.0073 | [-0.0365, +0.0510] | spans 0 |
| (B) vs `priorMajority` | +0.1369 | [+0.0692, +0.2066] | wholly above 0 |

Positive differences mean `numericTrend` is worse. (B) is wholly above 0, which is what the NEGATIVE rule requires.

## What this establishes and what it does not

Establishes: on these 16 held-out v0 CPU fixture families, `numericTrend` scored worse than the constant prior (`priorMajority`) on multiclass Brier, with interval support.
Its probabilities are overconfident and mostly point down while most outcomes are `none`. Comparison (A) does not separate it from its own shuffled-evidence control (the interval spans 0 and the
point estimate is slightly positive), so this run shows no evidence that `numericTrend` uses its evidence usefully. The two-class pattern (78 down, 18 up) was the same for the shuffled control.

Does not establish: anything about any model, GPU world, production preset or the naturalist feature; why `numericTrend` fails (no mechanism claim was tested); that no evidence-using rule could succeed.
The descriptive proposers (`v0Rules` had the lowest Brier, 0.437) cannot produce a POSITIVE or NEGATIVE claim under the amendment and are not read as one; `v0Rules` and `fixedRule` choose from the operation kind alone.
Limits as in the amendment: 20 fixture families of 32x32 CPU worlds, one rising recipe, donor-coupled dependence in (A) so its bootstrap is nominal, intervals descriptive at this n.
The v0 exploratory numbers are not merged with these. No post-hoc reinterpretation, family exclusion or threshold change was made.

Artifacts: `confirmation.json` (decision), `ledger.jsonl` (scoring input, 672 rows), `confirm.sha256` and `canonical.sha256` (both verify), `comparison.md`, `report.html` (failed predictions first, CONFIRM banner).

## All 73 failed `numericTrend` test predictions (family, case, observed, predicted)

| family | case | observed | predicted |
|---|---|---|---|
| c00 | c23f3f8d52556 | none | down |
| c00 | c420941860b2d | up | down |
| c00 | c9cfd541037bf | none | down |
| c00 | cc14c99cada64 | none | down |
| c02 | c125f9829b8cc | up | down |
| c02 | c461283ca938d | none | down |
| c02 | cb3898f726040 | none | down |
| c02 | ce5edf5ad9f86 | none | down |
| c04 | c401200359475 | none | down |
| c04 | c5a9b36a97a95 | none | down |
| c04 | c6ddf135ce8cd | up | down |
| c04 | cf88e3f90d7b1 | none | down |
| c05 | c4875bac8ad28 | up | down |
| c05 | c6dff1c67f3a1 | none | down |
| c05 | cd4c8ba2c3caf | none | down |
| c05 | ce0196b950eb3 | none | down |
| c05 | cfd7bfa59056b | none | down |
| c06 | c30425d1d1e61 | up | down |
| c06 | c77361a1b8316 | none | down |
| c06 | cc696d00387c2 | none | down |
| c06 | cffcf7859a07c | none | down |
| c08 | c1babc016be61 | none | down |
| c08 | c74b100c9a131 | none | down |
| c08 | c7f31b4227904 | up | down |
| c08 | c92dccc4fdfad | none | down |
| c09 | c25b52c9aebdb | none | down |
| c09 | c3e21b415a050 | none | down |
| c09 | c4b1943b94d93 | none | down |
| c09 | c666ad6c4127a | none | down |
| c09 | c6fe1b15a0ed4 | up | down |
| c10 | c43d57a54047f | up | down |
| c10 | c9b4ee626ca1e | none | down |
| c10 | c9f1e1ff47cfd | none | down |
| c10 | cc2b6bac36779 | none | down |
| c11 | c25c9fe3a8915 | none | down |
| c11 | c87ef966ccc3a | none | down |
| c11 | ca5fb08040179 | none | down |
| c11 | cfecb14ce71d0 | up | down |
| c12 | c2ff056f4f942 | none | down |
| c12 | c8100d781a9e0 | none | down |
| c12 | cc90ad1c3c9e6 | up | down |
| c12 | ce5ab20d58e34 | none | down |
| c13 | c0bf5eed7fc56 | none | down |
| c13 | c4f1f110004c9 | up | down |
| c13 | c77cbf6e43d35 | none | down |
| c13 | cb7f5d4bf7faa | none | down |
| c14 | c2689f98bcc63 | none | down |
| c14 | c6dc9d0562a1b | up | down |
| c14 | c855f323b70af | none | down |
| c14 | cf42e2a1b1747 | none | down |
| c15 | c42c760fd6b71 | down | up |
| c15 | c9140ff2ec40a | none | up |
| c15 | cb204b9b34494 | none | up |
| c15 | cbb917cca3bf2 | none | up |
| c15 | cc53bfdb98e50 | none | up |
| c15 | ce3298bd66017 | none | up |
| c16 | cab93b7a7a2c8 | none | up |
| c16 | cb27554203396 | none | up |
| c16 | cb61bd30ae832 | none | up |
| c16 | cb811f4f6ed96 | none | up |
| c16 | cc6fe40963501 | down | up |
| c16 | cf4761f4716ef | down | up |
| c17 | c0e2cc7e317c6 | none | up |
| c17 | c14eea139b129 | none | up |
| c17 | ca2ee74f20e54 | none | up |
| c17 | cac6c54fc013f | none | up |
| c17 | cc349d2a912c4 | none | up |
| c17 | cce06fc5fd698 | down | up |
| c19 | c1acbe8cb3064 | none | down |
| c19 | c1b7b961be910 | none | down |
| c19 | c1cce69db8d0f | none | down |
| c19 | c377b6da3e83f | none | down |
| c19 | c5b9aae6d10d6 | none | down |
