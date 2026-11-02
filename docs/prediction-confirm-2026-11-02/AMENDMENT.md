# Amendment 3 (2026-11-02): held-out confirmation of the prediction envelope on fresh families

Slice I02b, branch `claude/i02-confirm`. Dated amendment to `docs/prediction-envelope-2026-11-01/` (PLAN.md, EVIDENCE.md). It is committed, together with
`experiments/prediction-envelope/protocol.confirm.json` and `protocol.confirm.freeze.sha256` and the code that runs them, BEFORE any
outcome of a fresh family is computed. The confirm run refuses unless all three files are in HEAD byte-equal to the working copies, the
executable closure (`tools packages experiments/prediction-envelope deno.json package.json tsconfig.json`) is clean, and the output
directory is empty or absent. CPU only (sim-ref): no model call, no GPU, no network, no paid compute. This amendment is about the v0
CPU fixture mechanisms only; it says nothing about any model, GPU world, production preset or the naturalist feature.

Earlier text in this directory and in EVIDENCE.md is not edited. Where this amendment adds to it, it says so.

## 1. Identity

- Frozen v0 protocol (unchanged, not touched): `experiments/prediction-envelope/protocol.json`, hash
  `ad924e6bf6caaf78f99e1785728657d5f4a02e2938fa9d5d847140230b8da3b0` (`protocol.freeze.sha256`).
- Confirm protocol: `experiments/prediction-envelope/protocol.confirm.json`, hash
  `07dbf7333dcfc6d150c51a1071ef4f9c9616fa9bf32beec5d1187ff256bf620b` (`protocol.confirm.freeze.sha256`). `protocolHash` covers the families,
  so fresh families cannot live in the v0 file without changing its hash; the confirm protocol is a second file that is the frozen protocol
  with ONLY `salt`, `families`, `cohorts`, `donors`, `nDev`, `nQualify` replaced. Every other key (world, window, menu, mechanisms,
  proposers and their parameters, `minEffect`, `minEffectCandidates`, `devPrior`, `bootstrap`, `caps`, `seedVariantOffset`, versions, `frozen`)
  is byte-equal to v0 (canonical form), as `tools/test/prediction-confirm.test.ts` checks. This is a new protocol file sharing v0's frozen
  parameters, not "the v0 file unchanged".
- Salt `i02-prediction-confirm-2026-11-02`. Family ids `c00..c19` (v0 used `f00..f31`). Seeds `6000..6019` (v0: `5000..5031`; v0 variants
  `+7919` = `12919..12950`; the confirm protocol's would-be variants `13919..13938`; none overlap). The tests prove disjointness by effective
  simulation identity, `(seed, light, nutrient, founders)` and seed plus variant offset, against v0 `protocol.json` AND v0 `recipes.jsonl`,
  without simulating anything.
- 20 families, from the pure function `freshFamilies()` (`tools/lib/prediction/confirm.ts`): 15 original-style (indices `k = 0..14` of the v0
  cycle: `light = [spots, gradient][k % 2]`, `nutrient = [0, 1, 2][k % 3]`, `founders = 3 + k % 3`) and 5 in cohort `rising` (`spots`, nutrient 50,
  founders `1..5`, a prefix of the v0 rising list). A test reads the v0 `protocol.json` and asserts each fresh tuple equals the v0 tuple at the
  same cycle index. Rising share is 25% (5 of 20), equal to v0's overall rising share (8 of 32).
- Splits, from the unchanged `assignSplits`/`splitPlanOf` (a pure hash ranking, no outcome involved): `nDev` 3 original plus 1 rising,
  `nQualify` 0. Dev: `c03 c01 c07 c18`. Test (16 families = 12 original + 4 rising, 96 cases): `c05 c10 c11 c06 c08 c13 c00 c14 c04 c09 c02 c12 c19 c17 c16 c15`.
  16 is at least `MIN_FAMILIES_FOR_INTERVALS` (10). Donors for the shuffled control are the frozen within-split derangement stored in the protocol file.
- Transferred, not re-derived: `minEffect` 25 and `devPrior` `{up 135, down 271, none 594}` are taken from the v0 freeze unchanged. The fresh dev
  families only satisfy the split machinery (the oracle `mechanismRule` runs on them, descriptively) and play no role in any decision. There is
  no qualify subset and no dev stage, no threshold or prior is tuned on any fresh family.
- Size and budget were fixed from v0 evidence (`v0/meta.json`: 327641 ms for 32 families plus variants on an M1 Max, so about 3.5 minutes idle for 20
  families without variants and about 10 minutes at load x3). No smoke, timing, dev or generate run touched a fresh family before this commit.
  The size is never changed after the freeze commit.
- RESULT.md records the freeze commit SHA (the commit that contains this file).

## 2. No change

No threshold, `minEffect`, readout, proposer parameter, proposer, scoring rule, bootstrap setting (2000 resamples, seed 20261101), shuffled-control
construction, or fixture is changed. `tools/lib/prediction/score.ts`, `proposers.ts`, `readouts.ts`, `fixtures.ts` and the generate/scoring path of
`run.ts` are untouched. New code only adds the fresh-family recipe, the confirm gate and CLI plumbing, the ledger and the reading (all in
`confirm.ts`, `predict.ts`, `output.ts`, `report-html.ts`).

## 3. Primary comparisons

One primary rule: `numericTrend`, the single evidence-using proposer nominated in advance. Two primary comparisons on the test split, both on
imputed multiclass Brier (abstentions, invalid and missing predictions scored with the frozen dev prior), per-family means, paired whole-family
bootstrap of the difference `numericTrend` minus comparator with the protocol's resamples and seed, 95% percentile interval:

- (A) against `shuffledEvidence`, its own evidence-shuffled control;
- (B) against `priorMajority`.

Everything else (`v0Rules`, `fixedRule`, `shuffledEvidence`, `priorMajority`, `alwaysNone`, `abstainAll` and anything added later) is descriptive
and cannot produce a POSITIVE or NEGATIVE claim: `v0Rules` and `fixedRule` choose from the operation kind alone, so shuffling evidence cannot
change them and beating `priorMajority` would not show evidence use. `mechanismRule` is a dev oracle and is not evaluated on test. One named rule
with a conjunction of two comparisons means no across-rule multiplicity correction is needed or claimed. Secondary, descriptive: directional
accuracy, coverage, invalid counts, the trend-confound diagnostic, label agreement with fixture expectations, the measurement-limited share.

Stated limitation: the shuffled control for case i is another family's evidence from the cyclic donor map, so per-family differences in (A) are
mildly dependent and the independent-family bootstrap is nominal for (A); this amendment does not claim calibrated coverage for (A). POSITIVE
requires (B) as well, which has no donor coupling.

## 4. Reading, applied mechanically, in this precedence

The reading is the pure function `confirmReading` on the committed `ledger.jsonl` (one row per test case per non-oracle proposer) and the
parameters in `confirmation.json`; the delivered-output test recomputes it from the ledger.

a. **UNINFORMATIVE (override)** if any of: fewer than 10 test families; `meta.json` status is not `CONFIRM`; either primary interval is null or
   has a non-finite endpoint; the paired family or case sets of `numericTrend` and a comparator are not identical; `numericTrend` has any invalid
   or missing prediction on the test split; `numericTrend` answers zero test cases or predicts one class on all its answered test cases
   (degenerate); `priorMajority` or `shuffledEvidence` has any invalid or missing prediction (they are exempt from the degenerate check:
   `priorMajority` is constant by design); measurement-limited cases exceed 25% of test cases; provenance is not verified (see below). An override
   beats NEGATIVE and POSITIVE.
b. **NEGATIVE** iff some primary interval lies wholly above 0 (supported inferiority of `numericTrend`).
c. **POSITIVE** iff both primary intervals lie wholly below 0.
d. Otherwise **UNINFORMATIVE**, with the descriptive suffix "no improvement shown" when the point estimate against `priorMajority` is at least 0,
   else "improvement not supported". The suffix does not change the label; a nonnegative point estimate alone is never NEGATIVE.

## 5. Meaning

- POSITIVE: on these fixtures `numericTrend` beat its shuffled control and the prior out of sample. Not evidence for any model, production world
  or the naturalist feature.
- NEGATIVE: `numericTrend` is worse than a comparator with interval support.
- UNINFORMATIVE: the fixtures or counts could not decide; no claim.
- v0 exploratory numbers are not reused as evidence and are never merged into one table with these.

Status is earned, not read from `meta.json`. `confirm-analysis` first requires the data files to match `canonical.sha256` and the envelopes and
outcome rows to equal the case inventory the protocol implies (every family times every mechanism): a missing family is an error, never a
smaller ledger. It then withholds `CONFIRM` (the document status becomes `UNVERIFIED`, which is the same override as a non-CONFIRM status) unless
`meta.json` records an amended confirm-stage run that started with a clean closure, its snapshot is this recipe's protocol, and the committed
(HEAD) amendment, protocol and freeze match the recorded hashes. No stage other than the amended confirm run may simulate a protocol that uses the
reserved salt or seeds (smoke and dev refuse, renamed snapshots included).

## 6. Reporting and attempts

- Failed predictions are reported first and in full (RESULT.md, `report.html`); no post-hoc relabelling, threshold change, family exclusion or
  reinterpretation. Deviations go in a dated addendum below, never an edit of earlier text.
- The first completed run is the attempt of record and stays committed. Replays for reproducibility go to `/tmp` only and are compared by digest.
  If the run fails or a scoring bug is found: stop, record it in `docs/prediction-confirm-2026-11-02/BUG.md`, keep partial output untouched. A
  rerun on changed code needs a new dated amendment AND a newly drawn disjoint family set (new salt and seed range), because these families
  would have been seen. A crash before any outcome is written (for example out of memory) may be rerun unchanged on the same families.
- `envelopes.jsonl` and `predictions.jsonl` are gitignored like v0, with digests in `canonical.sha256`; `confirm.sha256` seals `confirmation.json`
  and `ledger.jsonl`.

## Limits

20 fixture families of 32x32 CPU worlds, one rising recipe; saturated worlds push labels toward "none"; the intervals are descriptive at this n;
the shuffled-control contrast has donor-coupled dependence; label agreement with expectations is reported, never forced.
