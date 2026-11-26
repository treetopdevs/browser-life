# I02 evidence: what the harness run showed, and what it did not

Slice S2, branch `claude/i02-prediction-envelope`, 2026-11-01. CPU only (sim-ref); no model call, no GPU, no network, no paid
compute. Outputs: `experiments/prediction-envelope/v0/` (see `comparison.md`, `report.html`, `meta.json`); regenerated 2026-11-01 with the rising cohort (Deviation 3). No advance or stop
decision about any model is evaluable from this run.

**Update 2026-11-02 (I02b):** a held-out confirmation on 20 fresh families was run and read mechanically: **NEGATIVE** for `numericTrend` (worse than `priorMajority`, interval above 0; not separable from its shuffled control). See `docs/prediction-confirm-2026-11-02/RESULT.md` and `experiments/prediction-envelope/confirm-2026-11-02/report.html`. The v0 text above is unchanged.

## Status of the delivered run: EXPLORATORY, not a held-out confirmation

`meta.json` says `status: "EXPLORATORY"`. The first delivered run (superseded) generated test-split outcomes from a working-tree
freeze that was never committed, and its test comparison was read before this fix pass. The `confirm` stage now refuses unless
`protocol.json` and `protocol.freeze.sha256` are both in HEAD and byte-equal to the working files (`git show HEAD:...`); the
delivered files were produced with `--exploratory yes`, which skips only that gate and stamps the output. A real confirmation
needs: commit the freeze, run `confirm` without the flag, and use **fresh families** (the 16 test families here have been
inspected; the first run's 12 were read before the rising cohort was added), recorded as a dated amendment. Until then every number below is a harness-behaviour statement on fixtures.

## Deviation 1: the primary readout is `bodyMass`, not `livingCells` (PLAN.md section 5, amendment 1)

PLAN revision 2 named `livingCells` (cells with a non-zero lineage word, cross-checked against `@bl/metrics census`). The dev
probe (12 dev families, feed on the heaviest cell, 512 quanta, radius 6) gave these paired `livingCells` effects:
`0,0,0,0,0,0,0,0,1,1,1,10` (eight of twelve exactly 0), while the same cases' `bodyMass` (B+P) effects were
`18, 49, 57, 110, 137, 225, 300, 325, 331, 400, 416, 462`. A lineage persists on a cell while its mass grows, so a feed does not
change the living-cell count and the "up" class was unreachable for a livingCells endpoint. `livingCells` and `freeNutrient`
remain computed per arm as diagnostics (`outcomes.jsonl` effect fields; `comparison.md` mean absolute effects). The
change was made before the freeze and is recorded here and in PLAN.md amendment 1; it was not tuned on test outcomes. The
earlier code comment cited this file before it existed; it now does.

Consequence for labels: feed cases that have zero living-cell effect are labelled by body mass, so most are "up". Label
agreement with fixture expectations (`comparison.md`, mechanism audit) is reported, never forced.

## Deviation 2: minEffect and the qualify subset

PLAN section 7 restricts `minEffect`, the dev prior inputs and any tuning to the reserved `qualify` subset (4 of the 12 dev
families: f00, f07, f09, f23). The first pass tuned on all 12 dev families (the `dev` stage generated all 12 and `freeze`
took `minEffect` and the prior from all of them) and picked 50. Disclosure: that choice was informed by all-dev tallies
(`feedOccupied` 10/12 up, `lowDoseFeed` 0/12 up at 50 but 2/12 up at 25, `drainOccupied` 3/12 down at 50 and 0/12 at 100). It
was a departure from the plan, not test leakage.

Fix applied: `qualificationReport` now tallies thresholds and cross-seed stability on the `qualify` subset only, and carries
`devEffects` (all 12 dev families) separately for the dev class prior alone (`devPrior` is the class frequency at the frozen
threshold over all dev cases; this is the "compute the full dev prior separately" fix, and PLAN section 7 is amended to say so).
The threshold rule applied to the qualify tallies, stated here as the rule (it is not independent of the earlier look, and the
earlier look is disclosed above): choose the candidate in `{25, 50, 100, 200}` with the largest count of cases matching
fixture expectations on the qualify subset, ties to the larger threshold. On the qualify tallies that is 25 (21 of 24
matching; 19 at 50, 19 at 100, 18 at 200), with cross-seed label agreement 22/24 (50: 21/24; 100: 22/24; 200: 23/24). So the
frozen `minEffect` is **25** body-mass quanta, `devPrior` up 180 / down 292 / none 528 (first pass, 12 dev families; Deviation 3 recomputes it over 16). The labelling convention is inclusive
at the boundary (`>= +minEffect` is up, `<= -minEffect` is down); `labelOf` is tested at +/-minEffect and just inside.

Stability is a heterogeneity measure across sibling seeds of one family, not a predictor ceiling, and 22/24 means two of 24
qualify cases flip label when the seed changes. `measurementLimited` flags (label changes at 0.75x or 1.25x the threshold)
cover 8 of 144 cases in the first run and 10 of 192 after Deviation 3; they stay in the unfiltered denominator.

## Deviation 3: the `rising` cohort (PLAN.md Amendment 2)

The first delivered run could not discriminate the baselines: every fixture world declined in body mass, so `numericTrend` and
`shuffledEvidence` both said "down" on all 144 cases and the trend-confound case never appeared. Amendment 2 adds eight families
(f24..f31: spots light, nutrient 50, founders 1,2,3,4,5,2,3,4, seeds 5024..5031) whose body mass rises through the observed window
with no intervention. The recipe was fixed by a probe that read only unperturbed mass trajectories (not a mechanism outcome, label,
threshold or score). The original 24 families keep their dev/test/qualify assignment (each cohort is split by its own hash ranking);
the cohort adds 4 dev and 4 test families. `minEffect` was not retuned: the Amendment 1 rule on the unchanged qualify tallies again
gives 25 (21 of 24 matching; 19, 19, 18 at 50, 100, 200). `devPrior` is recomputed over the 16 dev families:
up 135 / down 271 / none 594. Because the original dev and test families had already been inspected, this regeneration is
**EXPLORATORY** (`meta.json`), not a held-out confirmation. Cost: the dev stage took about 3 minutes and the full run about 6.3
minutes on one core (125 M cell-steps).

## What the run shows

192 cases (32 families, 6 mechanisms), 96 dev and 96 test. Test counts: up 12, down 27, none 57.

- Mechanism audit (all 192 cases, threshold 25): feedOccupied 23 up / 9 none; lesionOccupied 32 down; drainOccupied 21 down / 11 none;
  sham 32 none; lesionEmpty 32 none; lowDoseFeed 2 up / 30 none. Nothing was relabelled. In the rising cohort a feed on the heaviest
  cell has no measurable effect (8 of 8 none) and a drain only sometimes does (3 of 8 down): rich worlds are saturated.
- **The baselines now separate on real data.** On the test split `numericTrend` predicts up on 24 cases and down on 72, exactly
  the rising and declining families respectively. `shuffledEvidence` differs from `numericTrend` on 48 of 96 test cases (donors
  are a derangement over the combined split, so a rising family can receive a declining census and the reverse). Imputed Brier on test:
  `numericTrend` 0.704, `shuffledEvidence` 0.690, `priorMajority` 0.553, `fixedRule` 0.582, `v0Rules` 0.437.
- **The trend-confound negative case now appears in real data.** 35 of 192 cases have a treated value above the fork value; 14 of the
  64 intended-null cases (sham and low-dose feed; 62 of the 64 measure none, two low-dose cases measure up) are among them. On those 14 the naive before/after rule says up, `numericTrend`
  predicts up, and the paired outcome is none (`comparison.md`, trend-confound diagnostic: "the before/after rule, numericTrend and a
  paired outcome of none coincide on 14"). On the 24 test cases in rising families `numericTrend` is right on 0 (it says up everywhere; the labels
  are down 6, none 18); on the 72 test cases in declining families it is right on 21 (0.292).
- What this does not show: an evidence-using rule beating its shuffled control. `numericTrend` is no better than `shuffledEvidence`
  (0.704 vs 0.690 imputed Brier; the paired difference is not computed because both are weak) and both are worse than
  `priorMajority`. The harness can now tell a trend rule from its control; nothing in the data says the trend carries information about intervention effects.
- Strongest simple baseline on dev is `v0Rules` (dev 0.437; test 0.437), ahead of `priorMajority` (0.553 on test) and `fixedRule` (0.582);
  the dev-only `mechanismRule` oracle reaches 0.284 on dev and is not run on, serialised for or shown on test cases.
- The notebook and tables expose invalid, missing, extra and duplicate counts per proposer (`File-level diagnostics`).

## Limits the data impose (read before citing any comparison)

1. The rising cohort is one recipe (spots light, nutrient 50) at one fork step and horizon. It supplies rising baselines and the
   confound case; it is not a sample of rising worlds. Several of its mechanisms are null because the worlds are saturated, so
   it also shifts the label mix toward none (test none 57 of 96).
2. 16 dev and 16 test families (4 + 4 of them rising) is a harness check; intervals are whole-family bootstraps and are descriptive.
3. Fixtures are 32x32 CPU worlds with fixed mechanisms; the oracle, `v0Rules` and `fixedRule` differences largely reflect that
   `v0Rules` and `fixedRule` encode the operation kind. Nothing is claimed about production presets or any model.
4. The test families were inspected before this regeneration (the first run's comparison was read), and the rising cohort was
   written after seeing that run's degeneracy. No fresh held-out family exists yet; a confirmation needs fresh families recorded as a dated amendment.

## Reproduction

Reproduce the delivered files from the checked-in (frozen) protocol. `envelopes.jsonl` and `predictions.jsonl` are gitignored, so a clean
checkout has only the committed files; regenerate into a scratch directory and compare:
```
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
deno run -A --no-lock tools/predict.ts run --stage confirm --exploratory yes --out /tmp/pe2    # what produced the delivered files (about 5 minutes)
(cd /tmp/pe2 && shasum -a 256 -c canonical.sha256)                                              # the generated set verifies
diff <(cd /tmp/pe2 && cat canonical.sha256) experiments/prediction-envelope/v0/canonical.sha256   # equals the committed digests
diff -r --exclude=meta.json --exclude=dev --exclude=.gitignore --exclude=envelopes.jsonl --exclude=predictions.jsonl experiments/prediction-envelope/v0 /tmp/pe2
deno run -A --no-lock tools/predict.ts validate /tmp/pe2/predictions.jsonl
deno run -A --no-lock tools/predict.ts report --out /tmp/pe2   # re-render derived files from the data files
```
A real confirmation needs the freeze committed and fresh families (a dated amendment), then `run --stage confirm` without the flag.

To create a new protocol instead (move `protocol.json` and `protocol.freeze.sha256` aside first; the commands refuse otherwise):
```
deno run -A --no-lock tools/predict.ts protocol                      # draft, never overwrites
deno run -A --no-lock tools/predict.ts run --stage dev --out experiments/prediction-envelope/v0
deno run -A --no-lock tools/predict.ts freeze --min-effect 25 --out experiments/prediction-envelope/v0
# commit protocol.json and protocol.freeze.sha256, then run confirm
```
`envelopes.jsonl` and `predictions.jsonl` are gitignored (size budget) and regenerate byte for byte; their hashes are in
`canonical.sha256`, which is why the `diff -r` gate names `dev` and `.gitignore` as excluded and is only meaningful locally.
