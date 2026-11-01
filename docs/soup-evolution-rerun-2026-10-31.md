# Does evolution continue after takeover? The sharper rerun (2026-10-31)

A follow-up to [soup-evolution-2026-10-31.md](soup-evolution-2026-10-31.md) ("run 1"). It asks the same question of the same competitors, with races sized to answer it.

**Status: DRAFT.** These rules freeze when run 1's grid lineage (g1) has been analysed, and before any rerun race starts. The freeze is the commit that removes this line. After that, any change goes in a dated amendment section above the readout, and it names what it changes.

This is a prospective follow-up on competitors that run 1 already selected. Its design was written after seeing run 1's well-mixed results (below). It uses fresh seeds only.

## Why a rerun

Run 1's three well-mixed lineages showed turnover but not improvement. All figures here are from its 252 completed primary races for wm2, wm6 and wm8; g1 was still running.
- 5 of 42 pairs resolved.
- wm6 was NO DIRECTION; wm2 and wm8 were INSUFFICIENT EVIDENCE.

**1. Most races were too noisy to resolve.**
- The median within-cell standard deviation of final f is 0.059 (a cell is one pair in one direction, 3 seeds).
- Most |D| were under 0.1, against θ ≈ 0.14.
- Mean |f − 0.125| over all these races went from 0.017 at epoch 64 to 0.067 at epoch 512. That growth mixes selection, drift and classification effects, so it says nothing about how D itself grows.

**2. The noise control was asymmetric.**
- In wm6, the plain-rare runs ended above the marked-rare runs in all 6 same-seed comparisons: means 0.236 against 0.100. A sign test gives p = 2/64 two-sided, before allowing for having picked this out after the fact.
- This fits a marker-associated asymmetry. It may be a fitness cost, or the marker being misread or lost; the data cannot separate the two.
- σ0 was pooled over every lineage's calibration runs (seeds 1–3, both directions). So wm6's asymmetry raised every lineage's threshold.
- wm8's control showed no such pattern. wm2 had no usable marker.

Run 1's result stands as reported. The rerun's runs are not pooled with run 1's.

## What stays the same

- **Lineages and competitors:** wm2, wm6, wm8 and g1. Their competitors, frozen representatives, type radii and earlier/later order are read from run 1's `runs/soup/evo/plan.json` once g1 is in. Nothing is re-censused or re-chosen.
- **Races:** well-mixed soups of 16,384 programs at the paper's mutation rate, with the rare type at 2,048 (12.5%). Classification, f and the invalid-run rule are as in run 1, applied at the horizon H.
- **Verdicts:** the per-lineage verdict rule, the permutation test over competitor order, and the headline rule are as in run 1. TURNOVER comes from run 1's censuses.

## What changes

### Horizon and seeds

- **The horizon H is 1,024 epochs.** f is recorded every 64 epochs, with 8 seeds per direction (seeds 101–108).
- **Why longer races.** At equal compute, doubling race length and doubling seed count improve signal-to-noise about equally, if signal grows with t and noise with √t. Longer races are chosen because they can show slower advantages, which run 1 listed as a limit.
- **Fallback:** if the pilot fails (below), H is 512 epochs with 16 seeds per direction (seeds 101–116).
- **Everything is scored at H.** The primary outcome, validity and the coexist test all use H.

### Pair outcome, using each race's own spread

For a pair A, B: a_i is final f at H in valid A-rare runs, and b_j the same in valid B-rare runs.
- **Failed:** either direction has fewer than 6 valid runs (75%). A run whose f is not finite counts as invalid.
- **Otherwise:** D = mean(a) − mean(b). p is the exact two-sided permutation p for D: all C(nA + nB, nA) ways of splitting the pooled runs into groups of sizes nA and nB, with p = the share giving |D'| ≥ |D|.
  - Under "no advantage" the two directions are the same experiment with names swapped, so the runs are exchangeable.
  - The test needs no variance estimate and copes with zero variance and with f near 0 or 1.
- **A beats B** if p < 0.01 and D > 0. **B beats A** if p < 0.01 and D < 0.
- **Coexist:** if not resolved, and in each direction every valid run ends with the rare type above 0.125 (one-sided sign test, p ≤ 1/64 with 6 runs).
- **Unresolved:** otherwise.

With 63 pairs, about 0.6 false resolutions in all are expected if no pair truly differs.

**Completeness.**
- Every job runs exactly once. There are no replacement seeds and no extra runs after results are seen.
- The headline is INCOMPLETE until every job has a result file, valid or not.
- Failed pairs count against a lineage as in run 1: if more than a third of its pairs failed, the lineage is INSUFFICIENT EVIDENCE.

### The marker control is a symmetric sanity check, not a gate

- For each lineage's L0, take the two best candidates from run 1's marker procedure at different positions: fewest misreads in the seed-99 pilot, with ties going to the lower position. Call the two marked forms L0^1 and L0^2.
- **Classification.**
  - Align each program to L0 within L0's radius.
  - Read both positions. Marker 1 at position 1 and the original byte at position 2 makes it L0^1; the reverse makes it L0^2.
  - Anything else is "other": both markers, neither marker, or another byte.
- **Race:** L0^1 against L0^2, both directions, 8 seeds (seeds 201–208), scored by the pair rule above. If H falls back to 512, it uses 16 seeds (201–216) at 512.
- **Expected outcome:** unresolved.
  - If it resolves, the report says the two marked forms differ, whether by cost or by misreads. Nothing else changes.
  - A lineage with fewer than two usable markers reports "no marker control".
- It never gates the verdict.

### Secondary: the 512-epoch reading

Only when H is 1,024: the same runs are read at epoch 512 and scored with the same rules, validity included. This is reported beside the primary result as a check against run 1, and it is not scored.

### Dropped from the rerun

The grid races, cross-time races (xpair), probes and trends. Run 1 reports them, and the rerun answers only the headline question.

## Pilot, fixed now

- **Races:** wm6's and wm8's first two competitors in run 1's order (the two earliest leaders), both directions, seeds 901–902, at 1,024 epochs. That is 8 runs.
- **Go at H = 1,024** if, at epoch 1,024, every pilot run passes both checks:
  - It is valid under the invalid-run rule.
  - "Other" is at most 50% of the soup.
- **Otherwise** H = 512.
- The pilot is a feasibility check on two lineages only, not proof for all four. If H is 1,024, a main-batch run that turns invalid simply counts as invalid.
- The pilot is not scored, and its seeds are never reused.

## Size and cost

- **Pairs:** wm2 6, wm6 15, wm8 21, g1 21 (g1 is to be confirmed from its plan), 63 pairs in all.
- **Runs:** 1,008 race runs plus up to 64 marker-control runs, at 1,024 epochs.
- **Time:** about 10 hours at run 1's measured rate (3.6 runs of 512 epochs a minute on 6 workers).
- **Cost:** local CPU only.
- **Output:** `runs/soup/evo2/`.

**Expected sensitivity, not a promise.** With a per-direction standard deviation near run 1's 0.059 and 8 runs a side, the standard error of D is about 0.03, so a p below 0.01 needs |D| of roughly 0.08–0.09. Noise at 1,024 epochs is unknown.

## Headline (run 1's rule, applied to the rerun's verdicts)

1. **"Evolution continues: later copiers beat earlier ones"** if at least 2 of the 4 lineages are both TURNOVER and ADAPTIVE.
2. **"Copiers keep replacing each other; improvement not shown"**: otherwise, if at least 2 lineages are TURNOVER.
3. **"Stasis after takeover"**: otherwise, if at least 2 lineages have no turnover.
4. **"Little turnover"**: otherwise.

Reported beside the headline:
- Each lineage's resolved pairs, q and p.
- CYCLIC triples and coexisting pairs.
- The marker controls.
- The 512-epoch reading.

## Limits

- The competitors are run 1's. A poor representative stays poor.
- The permutation test assumes the two directions are exchangeable under "no advantage". Seeding is symmetric, but two-form types are split 50/50, which may not match their natural ratio (as in run 1).
- The races are well-mixed only, so any claim of improvement applies to the stirred soup.
