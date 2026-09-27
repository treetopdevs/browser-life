# Anticipation: the fitness cost of unpredictability

Track: does an evolved population pay a *larger* relative fitness cost than an
unevolved (founder) control when a predictable light cycle it has adapted to is
broken by an unannounced period change, versus when it simply continues --
evidence, pending the light-regime-specialization confound (section 4), that it
specialised to the cycle's *timing*, not just its presence? No rule change
anywhere here: `WorldConfig.seasonPeriod`/`seasonAmp` already drive the
triangle-wave light cycle, unchanged from `packages/sim-ref/src/step.ts`.

## 1. Why phase lead cannot answer this question

A phase-lag estimator (does a population *lead* the periodic light cycle?)
cannot decide this question: against a perfectly periodic triangle light,
recent light history already predicts future light, so a purely causal,
memoryless reactive filter with no lookahead (`y[t] = a*x[t] + x[t] - x[t-1]`)
reproduces a signed phase lead, re-entrainment after a period change, and a
fixed raw-sample lead, none of which require anticipation -- it cannot
distinguish "predicts the future" from "reacts fast to a predictable past," so
this track poses a fitness comparison, not a timing one.

## 2. The estimand: a difference-in-differences over whole seed-worlds

For each M3-confirmed founder seed-world, **Phase A** runs two arms under a
predictable cycle at period `P` for `periodsA` periods, from the same founders
and otherwise identical config: **EVOLVED** (ordinary mutation, selection acts)
and **FOUNDER** (the existing "no-mutation" condition -- same ecology and
acclimation, no new variation; selection can still sort among the founder
genotypes already present, so this arm controls for mutation, not for all
adaptation). **Phase B** branches from each Phase A end-state in memory (no
checkpoint round-trip in the control-flow path, proven state-equivalent to one
in `tools/test/fixtures/anticip-checks.ts`) into **CONTINUE** (stay at `P`) and
**SWITCH** to an unannounced `P'`, for both a shorter and a longer `P'`.
Response is world total biomass (`totalsOf(cfg, cells).B`) at a fixed horizon
of `k*P` steps, the same absolute step count for every branch, after the
branch:

```
cost        = log(resp_switch / resp_continue)
index       = cost_evolved - cost_founder      // per seed-world, per switch direction
```

A negative index means EVOLVED paid a *larger* relative cost from losing
predictability than FOUNDER did -- evidence of differential *sensitivity*, not
proof of timing-specificity alone: general light-*regime* specialisation could
show the same signed result (section 4), so read it as evidence only alongside
that confound discussion. The replicate unit is the whole seed-world, never a
founder within one: founders share an environment and aren't independent draws,
so inference is paired **across seeds**, never founders. Prediction: if
organisms exploit the cycle's predictability, `index < 0` for at least one
direction -- plausibly the shorter switch, which packs more cycle transitions
into the same fixed horizon (`k*P` steps, unchanged by `P'`), leaving less
time within each cycle to reacclimate before the next one begins.

## 3. Primary endpoint and inference

Primary endpoint: log biomass. Total free-energy stock (`totalsOf(...).energy`)
is reported alongside it as a descriptive secondary figure, not part of the
primary test.

Per switch direction (shorter, longer), the **primary estimand is the mean
anticipation index across seed-worlds**, not the median or a signed-rank test's
location. Primary inference: a percentile bootstrap CI of that mean
(`tools/lib/anticip-stats.ts`); support means the CI's upper bound is below 0.
Holm adjustment (used for the secondary p-value below) does not apply to CIs;
rather than two unadjusted marginal 95% intervals judged individually, this
analysis reports **Bonferroni-adjusted 97.5% intervals** (`alpha = 0.05 / 2`
directions) as the primary decision rule. `meanIndex`, the point estimate
matching the CI, is always reported, even when the CI itself is unavailable;
`medianIndex` is descriptive only.

A secondary one-sided Wilcoxon signed-rank test (H1: the index's distribution
is symmetric about a negative location) is also reported per direction,
Holm-adjusted as its own 2-member family, and **assumes symmetry under H0** --
it tests location, not the mean; report it only alongside the primary CI.
Neither method protects against an unobserved tail: for a zero-mean population
with index -1 w.p. 20/21 and +20 otherwise, 8 draws are all -1 about 68% of
the time, and then Wilcoxon gives p ~ 0.0039 and the bootstrap CI is [-1, -1].
With a handful of seed-worlds a negative mean is only as credible as the
assumption that the index distribution has no rare large positive outcomes.

The CI is unavailable rather than fabricated when it cannot be computed
honestly -- fewer than 2 surviving seed-worlds (`"insufficient-replication"`)
or fewer than 200 bootstrap replicates (`"insufficient-reps"`) -- `lo`/`hi:
null`, `meanIndex` only, either way. Even a nominally `"ok"` CI is coarse below
roughly 5-6 seed-worlds (`n=2` reaches only 3 distinct resample means); a
narrow low-`n` CI is an artifact of that, not a strong result.

A seed-world is excluded from a direction's inference whenever either arm's
response there is non-positive (collapse), never turned into an undefined log,
at one of two points, both reported so no run silently drops seed-worlds:
`seeds[].collapsedPhaseA` (one arm's Phase-A end-state was already
non-positive, so the seed-world was never branched -- excluded from *both*
directions) and `family.<dir>.collapsed` (Phase A was viable, but one arm's
branch in *this* direction collapsed). Each direction also carries its own
`phaseACollapsed` count (same in both), so `collapsed + phaseACollapsed` is
that direction's full exclusion count -- `n` plus that sum always equals the
requested seed count, a caveat on how to read the inference, not folded into
the index.

## 4. Confounds

**Named confound:** an evolved population may be specialised to the light
*regime* in general (mean, amplitude, variance), not its *timing* -- a period
switch changes both at once, and no predictability-preserving light
perturbation exists. The best available partial control, changing light without
touching `seasonPeriod`, is a same-period **level shift**
(`--control-level-shift`): shift `lightBase` by the *signed* realized
light-mean change the "longer" switch produced (`lightMeanDelta`) -- tests
fragility to a light-*level* change generally (weaker than timing-
specialisation), reported descriptively, not as a Holm-family member. It can
fail to produce a usable number, both reported rather than silently zeroed or
crashing: a change under 0.5 rounds to delta 0 (`applied: false`); a delta too
large for the light range (`lightBase + delta` outside `0..255`) is
`unavailable: true` with a `reason`. A control isolating timing alone (same
statistics, different phase) needs a phase-offset light primitive that does not
exist today; adding one is a rule change, left as a proposal.

Three pairs among the 12 M3 founders (`M3_FOUNDERS.length`, `packages/schema/src/
founders.ts` -- cluster 23 was dropped on replication, leaving 12) are
near-duplicate genomes by weight-byte inspection (clusters 9/20, 12/17,
4/10); `results.json`'s per-founder mass breakdown (`founderMassAtBoundary`)
should not be read as 12 independent genotypes -- this doesn't affect the
world-level primary analysis. If the confirmed set's size changes again,
re-check this paragraph and the `--founders 12` example below against the
new `M3_FOUNDERS.length` rather than assuming the count or the named
clusters still hold.

**What a null result means:** a null result (CI spanning 0, large Holm-adjusted
p) bounds the claim to "not detected at this `k`, these switch periods, this
population size, this many Phase A periods" -- not "purely reactive," absent a
minimum-detectable-effect figure. A short Phase A or too short a horizon `k`
are both consistent with a genuine effect this run lacked power to see.

## 5. How to run

Pilot (tiny, fast, a pipeline check only -- not evidence either way; 6 Phase-A
periods gives selection nowhere near enough time to specialise):

```
deno run -A tools/anticip.ts --seeds 1,2,3 --period 200 --periods-a 6 \
  --switch-shorter 100 --switch-longer 400 --k 2 \
  --tile 48 --founders 5 --kernel-radius 5 \
  --out runs/anticip/pilot-<name>
```

Re-run against the 12-founder set (cluster 23 dropped, `packages/schema/src/
founders.ts`): completes at ~132 steps/s single-core, all 3 seeds survive
Phase A and both switch directions (`n=3`, `collapsed: 0`, `phaseACollapsed:
0` in both `family.shorter`/`family.longer`) -- as expected for a pipeline
check with `--founders 5`, well under the new `M3_FOUNDERS.length` of 12, so
this pilot's own numbers are unaffected by the founder-set change.

Evolutionary-scale run: `--period 2000 --periods-a 50 --tile 256 --founders 12
--switch-shorter 1000 --switch-longer 4000 --k 5`, 8 seeds -- ~2.08M total
steps (this total depends only on seeds/period/periods-a/k, never on
`--founders`, so it is unchanged by the set's 13-to-12 drop); `--founders 12`
is the full current `M3_FOUNDERS.length` -- update this example if the
confirmed set's size changes again. CPU-only (`RefSim`); a `GpuSim` swap
inside `phaseA`/`branch` is mechanical. Measured on one machine, single
core, at the actual target tile size (`--tile 256 --kernel-radius 9
--founders 12`, one seed, `--periods-a 1`): ~4.0 steps/s, versus ~132 steps/s
at the pilot's `--tile 48 --kernel-radius 5` -- about 33x slower, less than
the ~85x a naive tile-area x kernel-area product would suggest (256^2/48^2 x
19^2/11^2), so per-step cost does not scale that simply and every new tile
size still needs its own measurement, not this ratio applied elsewhere. At
~4.0 steps/s the full ~2.08M-step run is roughly 144 hours (about 6 days) run
sequentially, single-threaded, on that machine -- recalibrate on the actual
target hardware before committing to this run, since the per-step rate is
machine-dependent; the `GpuSim` swap above is the intended way to make this
run tractable, not a longer CPU wait. 8 seeds is a wall-clock budget, not a
powered sample size (a one-sided paired test at `alpha=0.05`, `n=8` has 80%
power only for `d ~ 0.9` or larger) -- more seeds, not a different test,
buys power.

## 6. Verify

```
cd /Users/nicholas/develop/browser-life-anticip
pnpm vitest run packages/metrics/test packages/schema/test tools/test
pnpm typecheck && deno check tools/anticip.ts tools/lib/*.ts
deno run -A tools/anticip.ts --seeds 1,2 --period 200 --periods-a 4 \
  --switch-shorter 100 --switch-longer 400 --k 2 --tile 48 --founders 5 \
  --kernel-radius 5 --out /tmp/anticip-smoke
```
