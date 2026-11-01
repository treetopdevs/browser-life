# I02 evidence: what the harness run showed, and what it did not

Slice S2, branch `claude/i02-prediction-envelope`, 2026-11-01. CPU only (sim-ref); no model call, no GPU, no network, no paid
compute. Outputs: `experiments/prediction-envelope/v0/` (see `comparison.md`, `report.html`, `meta.json`). No advance or stop
decision about any model is evaluable from this run.

## Status of the delivered run: EXPLORATORY, not a held-out confirmation

`meta.json` says `status: "EXPLORATORY"`. The first delivered run (superseded) generated test-split outcomes from a working-tree
freeze that was never committed, and its test comparison was read before this fix pass. The `confirm` stage now refuses unless
`protocol.json` and `protocol.freeze.sha256` are both in HEAD and byte-equal to the working files (`git show HEAD:...`); the
delivered files were produced with `--exploratory yes`, which skips only that gate and stamps the output. A real confirmation
needs: commit the freeze, run `confirm` without the flag, and use **fresh families** (the 12 test families here have been
inspected), recorded as a dated amendment. Until then every number below is a harness-behaviour statement on fixtures.

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
frozen `minEffect` is **25** body-mass quanta, `devPrior` up 180 / down 292 / none 528. The labelling convention is inclusive
at the boundary (`>= +minEffect` is up, `<= -minEffect` is down); `labelOf` is tested at +/-minEffect and just inside.

Stability is a heterogeneity measure across sibling seeds of one family, not a predictor ceiling, and 22/24 means two of 24
qualify cases flip label when the seed changes. `measurementLimited` flags (label changes at 0.75x or 1.25x the threshold)
cover 8 of 144 cases; they stay in the unfiltered denominator.

## What the run shows

- Mechanism audit (all 144 cases, threshold 25): feedOccupied 23 up / 1 none; lesionOccupied 24 down; drainOccupied 18 down /
  6 none; sham 24 none; lesionEmpty 24 none; lowDoseFeed 2 up / 22 none. Nothing was relabelled.
- Strongest simple baseline on dev: `v0Rules` (the v0 rule table mapped into the schema). It leads the test split as well
  (imputed Brier 0.417 vs `priorMajority` 0.594 and `fixedRule` 0.540). The dev-only `mechanismRule` oracle reaches 0.227 on dev;
  it is not run on, serialised for or shown on test cases (fix for review finding 7).
- The notebook and tables expose invalid, missing, extra and duplicate counts per proposer (`File-level diagnostics`).

## Limits the data impose (read before citing any comparison)

1. **numericTrend and shuffledEvidence are degenerate.** Both predict "down" on all 144 cases because every fixture world is
   declining in body mass over the observed window (`comparison.md`, "Predicted class on the test split"). They therefore tie
   exactly and the run does **not** show the harness separating an evidence-using rule from its shuffled control. What is
   demonstrated instead, by unit test (`prediction-proposers.test.ts`, "opposite trends"), is that the two rules do differ on a
   rising/falling pair: `numericTrend` says up on a rising census and down on a falling one, and `shuffledEvidence`, handed the
   other family's census, says the opposite. The question "does a real evidence-using rule beat its shuffled control" is open.
2. **The before/after trend confound does not appear in these fixtures.** No case has a treated value above its fork value
   (0/144), so the naive before/after rule never says "up" on the sham or low-dose cases. The confound arithmetic is verified on
   a synthetic rising set (`trendConfoundOf` test) only.
3. Fixtures are 32x32 CPU worlds with fixed mechanisms; the oracle, `v0Rules` and `fixedRule` differences largely reflect that
   `v0Rules` and `fixedRule` encode the operation kind. Nothing is claimed about production presets or any model.
4. 12 test families is a harness check; intervals are whole-family bootstraps and are descriptive.

## Reproduction

```
export PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH
pnpm install
deno run -A --no-lock tools/predict.ts protocol                      # draft, never overwrites
deno run -A --no-lock tools/predict.ts run --stage dev --out experiments/prediction-envelope/v0
deno run -A --no-lock tools/predict.ts freeze --min-effect 25 --out experiments/prediction-envelope/v0
# commit protocol.json and protocol.freeze.sha256, then (no flag) the real confirmation:
deno run -A --no-lock tools/predict.ts run --stage confirm --out experiments/prediction-envelope/v0
deno run -A --no-lock tools/predict.ts run --stage confirm --exploratory yes --out /tmp/pe2    # what produced the delivered files
(cd experiments/prediction-envelope/v0 && sha256sum -c canonical.sha256)
diff -r --exclude=meta.json --exclude=dev --exclude=.gitignore experiments/prediction-envelope/v0 /tmp/pe2
deno run -A --no-lock tools/predict.ts validate experiments/prediction-envelope/v0/predictions.jsonl
deno run -A --no-lock tools/predict.ts report --out experiments/prediction-envelope/v0   # re-render derived files from the data files
```
`envelopes.jsonl` and `predictions.jsonl` are gitignored (size budget) and regenerate byte for byte; their hashes are in
`canonical.sha256`, which is why the `diff -r` gate names `dev` and `.gitignore` as excluded and is only meaningful locally.
