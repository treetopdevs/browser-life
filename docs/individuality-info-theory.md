# Information-theoretic individuality vs. genetic/component individuality

Implements and runs the information-theoretic individuality measures of
Krakauer, Bertschinger, Olbrich, Flack & Ay, "The information theory of
individuality" (arXiv:1412.2447 preprint; *Theory in Biosciences*
139:209-223, 2020), compared against this repo's genetic-cluster and
tracked-component/collective definitions. Code: `packages/metrics/src/individuality.ts`
(pure estimators), `tools/individuality.ts` (CLI running R analysis plus C
calibration replicate CPU-reference worlds, producing the disagreement table
below). Detected here, never declared (`docs/plan.md`); a held-out
observable (§7).

## 1. Definitions

For system state `S` and environment state `E`, both discrete, at
consecutive recorded steps:

```
A*   = I(S_{n+1}; S_n)             organismal / "genomic determination"
A    = I(S_{n+1}; S_n | E_n)       colonial / autonomy given environment
nC   = I(S_{n+1}; E_n | S_n)       driven / non-closure
NTIC = A* - A                      "non-trivial informational closure"
```

`A` and `nC` are exact algebraic derivations of `autonomyStar` (`A*`),
`jointMI` (`I(S,E;S')`) and `environmentMI` (`I(E;S')`) by the MI chain rule
(`I(S,E;S') = I(E;S') + I(S;S'|E) = I(S;S') + I(E;S'|S)`): `A = jointMI -
environmentMI`, `nC = jointMI - autonomyStar`, both Miller-Madow corrected
throughout so they are internally consistent by construction. A bivariate
partial information decomposition (PID, Williams & Beer 2010, `I_min`) of
`I(S_{n+1}; S_n, E_n)` additionally reports redundancy, unique-to-S,
unique-to-E and synergy. `nC = uniqueE + synergy` holds exactly among the
plugin (uncorrected) PID quantities, but not numerically against the
bias-corrected `nonClosure` (PID is deliberately plugin-only, §2).

## 2. Estimators and biases

- **Miller-Madow correction**: additive, per entropy term, `H_corrected =
  H_plugin + (nonempty bins - 1) / (2 N ln 2)`; still under-corrects with
  many low-probability cells, so every quantity is read with its CI/null.
- **A corrected `nonClosure` (or PID `uniqueE`/`synergy`) point estimate can
  be negative, even though the population quantity it estimates cannot be**:
  `nC = I(S_{n+1};E_n|S_n) >= 0` always holds for the true distribution, but
  the Miller-Madow correction is added separately to each of the three
  entropy terms it's built from (`H(S,E)`, `H(S)`, `H(S,E,S')`, `H(S,S')` --
  see `nC = jointMI - autonomyStar`), and those three corrections do not
  cancel in general at small `N`. Constant `S`, `E = [0,0,1,1]`, `S' =
  [0,1,0,1]` (`N=4`) gives a corrected `nonClosure` of exactly `-0.180337`:
  `autonomyStar` is exactly 0 (a constant `S` carries no information about
  anything, corrected or not), while the corrected joint MI of `(S,E)` against
  `S'` dips below 0 because `H(E,S')`'s correction term (4 nonempty cells out
  of `N=4`, the worst-case Miller-Madow case) outweighs `H(E)`'s and
  `H(S')`'s combined. Read every point estimate together with its CI or
  cross-world-null `p`, never as a standalone sign check -- see §3's note on
  why the one-sided upper-tail alternative is still correct despite this.
- **`I_min` PID is plugin-only**: no established bias correction exists for
  `I_min`, and mixing corrected whole-quantity MIs with an uncorrected
  `I_min` breaks the Williams-Beer nonnegativity bounds -- read as more
  small-sample-inflated than `autonomyStar`/`jointMI`/`nonClosure`.
- **Two coarse-graining profiles**: default (`|S|=12, |E|=6`) and coarser
  (`|S|=8, |E|=4`), fit from the same raw feature histories as a sensitivity
  check on the binning choice, reported side by side per aggregate.

## 3. Calibration worlds, the frozen bins, the cross-world null, and the bootstrap

A "world" is one independent replicate: the same config and founder layout,
a different seed. `tools/individuality.ts` runs R **analysis** worlds
(R=8-16 at this scale, `--worlds`) and C **calibration** worlds
(`--calibration-worlds`, default 4), both settling for `--window-start`
steps then recording `--window-steps` more (analysed length `T` =
`--window-steps - 1`: one recorded point is consumed only as `S`'s own
successor). Calibration worlds use seeds disjoint from every analysis
world's seed -- `CALIBRATION_SEED_OFFSET` (a large fixed constant) added to
the base `--seed`, so disjointness holds for any realistic `--worlds` count
without the two ranges ever needing to be checked against each other at
runtime -- and are otherwise run exactly like analysis worlds (same
geometry, same founders, same window).

**Quantile bins are fit only from the calibration worlds, then frozen
before any analysis world is symbolized.** `S` and `E` are quantile-binned
from continuous raw per-step feature histories (logMass, membraneFraction,
photoShare, meanLight, meanNutrientA -- §1). For each aggregate anchor (a
genetic cluster, a component, or a colony composition) and each
coarse-graining profile, the bins are fit from that SAME anchor's own
calibration-world histories when at least 2 calibration worlds had that
exact anchor eligible; otherwise they fall back to bins fit from every
calibration-world point pooled together, across every anchor of every kind.
Fallback, not exclusion: the five features above are per-cell physical
summaries with the same meaning and scale regardless of which founder or
colony produced them, so pooling across anchors for the fallback does not
mix incomparable quantities, and it keeps every analysis anchor answerable
rather than dropping a row the run would otherwise report -- a colony's
specific cluster composition, in particular, is a settle-phase outcome that
may not recur in a handful of calibration worlds even though it recurred in
several analysis worlds. Once fit, the bins for a given anchor+profile are
frozen: no analysis world, no bootstrap resample of analysis worlds, and no
permutation of which analysis world's `E` accompanies which world's `S`/`S'`
ever refits them. This matters because a bin fit that included the very
analysis data being resampled or permuted would fit each repeated/permuted
world more tightly than an independent fit could, biasing every downstream
plug-in-MI quantity upward -- there is no way to correct for that bias from
inside the resampling procedure itself, so bin-fitting is kept wholly
external to both the bootstrap and the permutation null.

For a quantity whose null hypothesis is "no S-E coupling" (`nonClosure`, PID
`uniqueE`, PID `synergy`), each analysis world's own statistic (computed with
the frozen bins) is computed once (`observed` = their mean across the R
worlds) and ranked against a permutation test over the full symmetric group
`S_R` of the R analysis worlds. Under H0 the S-series and E-series of i.i.d.
replicate worlds are independent, so the joint law is invariant under *any*
relabelling `pi` of which world's `E` accompanies which world's `S`/`S'` --
not just relabellings with no world mapped to itself. The reference
statistic is `T(pi) = mean over a of stat(S_a, E_{pi(a)}, S'_a)`, evaluated
over every permutation of the R worlds, including the identity (`T(id) =
observed` exactly, since pairing every world with its own `E` is what
`observed` already is). Because the identity is exchangeable with every
other permutation under H0, it is always one of the reference values
`observed` is ranked against, which is what guarantees a valid,
non-anti-conservative p-value: `p = #{pi : T(pi) >= T(id)} / R!` when every
permutation is enumerated exactly (`R <= 8`, `8! = 40,320`), or `p = (1 +
#{draws with T >= observed}) / (nullDraws + 1)` when `nullDraws` (default
2000) permutations are instead sampled uniformly at random from `S_R`
(Fisher-Yates; the identity can be drawn like any other permutation, with
probability `1/R!`, and is not treated specially or excluded). This matters
most at the small R this tool routinely produces -- many anchors survive in
only 2-9 of the analysis worlds, where `R!` is tiny (`2!=2`, `3!=6`,
`4!=24`): with so few exchangeable arrangements, the exact test's p-value is
bounded below at `1/R!` (0.5 at R=2, 1/24~=0.042 at R=4) and cannot be
sharper than that no matter how many times the null is resampled.

One-sided upper-tail -- but **not** because swapping which world's `E`
accompanies which world's `S`/`S'` can only ever destroy real coupling: it
cannot, in general. Two length-5 histories with `S = E`, `[0,0,1,1,0]` and
`[0,1,1,0,0]`, give a corrected `nonClosure` of exactly `0` for the identity
pairing but `1.36` after swapping which world's `E` each one gets -- the
permutation reference distribution is not stochastically bounded above by
the observed value, so that cannot be the reason for ranking against the
upper tail. The actual justification does not rely on any such ordering:
under H0 the R worlds are i.i.d. replicates with no genuine S-E coupling, so
every world's `E`-series is EXCHANGEABLE with every other world's --
relabelling which world's `E` accompanies which world's `S`/`S'` under any
permutation `pi` leaves the joint law unchanged. That exchangeability alone
is what makes `{T(pi)}` a valid reference distribution for `observed =
T(id)`: a uniformly drawn permutation (including the identity) is equally
likely under H0, so ranking `observed` against all of them gives a
p-value uniform on `{1/R!, 2/R!, ..., 1}`, regardless of what any single
non-identity permutation's value happens to be. The upper tail is then a
separate, deliberate choice about the ALTERNATIVE, not a consequence of the
null's shape: `nC = I(S_{n+1};E_n|S_n)`, PID `uniqueE` and PID `synergy` are
true mutual-information-derived divergences, exactly 0 under independence
and never negative as population quantities, so "more coupling than the
exchangeable null" is the only alternative worth testing for, and the upper
tail is what represents it -- regardless of whether the corrected point
estimate of any one permutation (observed or swapped) dips below 0 in a
small, close-to-independent sample (§2's worked example).

Everything else (`autonomyStar`, `jointMI`, `environmentMI`, `A`, `NTIC`,
PID `redundancy`, PID `uniqueS`) gets a **bootstrap-over-worlds CI** instead:
the statistic is computed once per analysis world with the frozen bins,
`point` is the mean of those R values, and the interval resamples analysis
worlds with replacement and re-averages `draws` times -- never pooling raw
per-step symbols across worlds (which would conflate between-world
heterogeneity, i.e. different seeds' marginal distributions, with real
within-world coupling), and never touching the bins.

**This is a nominal 90% percentile interval that undercovers, reported as
an interval only at `R >= MIN_CALIBRATED_WORLDS` (8) -- a reporting
threshold, not a calibration guarantee; below it the output is a
descriptive resampling range.** `packages/metrics/test/individuality.test.ts` measures the
percentile interval's empirical coverage against a known target (the
population mean of the same fixed-bin statistic over a large number of
independent synthetic worlds, all quantile-binned with bins fit once from a
separate calibration sample) at a nominal 90%, over 300 trials: `R=12`
covers ~84% (below nominal), `R=4` covers ~74% -- a
~10-point gap far larger than the trials' sampling noise. `8` is chosen as
the threshold between them: it is closer to `R=12`'s coverage than to
`R=4`'s in the monotonic trend measured during development (`R=6` ~82%,
`R=8` ~83%, `R=12` ~84%), and it is also where the number of distinct
with-replacement resamples a percentile bootstrap can draw from
(`C(2R-1,R)`: 35 at `R=4`, 6435 at `R=8`) stops being vanishingly small.
Below the threshold, `BootstrapCI.status` is `"uncalibrated"` and
`tools/individuality.ts` reports `[lower, upper]` as a descriptive
resampling range rather than a confidence interval; this affects most of
this tool's own rows, since many anchors survive in fewer than 8 of the
analysis worlds (§5). The cross-world null's `p`/`p_holm` are unaffected by
this threshold -- the permutation test's validity does not depend on R in
the way the percentile bootstrap's coverage does, only its resolution
(`1/R!`, above). The coverage check used one synthetic statistic
(`autonomyStar`); read every reported interval as roughly 80-85% coverage
at best, not 90%.

**The nonClosure interval and the permutation p answer different
questions.** The bootstrap interval targets the mean finite-window,
Miller–Madow-corrected statistic given the frozen bins, residual estimation
bias included, so it can exclude 0 with no real coupling at all. The
permutation p asks whether within-world pairing gives a higher statistic
than cross-world pairing. Only the p-value is evidence of S–E coupling; an
interval excluding 0 next to a large p (e.g. genetic-cluster 0 below:
`[0.009, 0.054]`, `p=0.534`) is not.

**Sample-size rule**: target average occupancy >= 2 samples/cell on the
largest table (`|S|*|E|*|S|`), i.e. `T >= 2*|S|*|E|*|S|` -- 1728 at the
default profile; the tool warns (not exits) if a run falls under it. This is
a **per-world** floor, not `worlds*T`: every MI table here is fit once per
world from that world's own `T` observations (never pooled across worlds --
see above), so running more worlds sharpens the *mean across worlds* but
adds nothing to any single table's occupancy.

**Multiple comparisons**: every aggregate (with >=2 eligible analysis
worlds) at both coarse-graining profiles gets 3 null-tested quantities
(`nonClosure`, PID `uniqueE`, PID `synergy`) -- 54 tests in the run in §5
below -- and `tools/individuality.ts` Holm-corrects across that entire
declared family before reporting any `p_holm`; nothing is gated on either
the raw or adjusted value. The disagreement table (§5) separately
recomputes a few of these same quantities on smaller, pairwise-matched
world subsets to compare two definitions against each other on a controlled
population; those p's answer a different question, are not part of this
family, and are reported raw, uncorrected.

## 4. Fixed aggregates

Three aggregate kinds, each defined **once, at window start**, from a
definition fixed before any recording begins. Once excluded, a world is never
spliced back together for that anchor -- excluded stays excluded for the rest
of the window. Each kind's own exclusion trigger is different, because each
is anchored to a different underlying identity:

- **genetic cluster**: all living cells of an M3 founder's lineage,
  aggregated by cell/lineage identity regardless of which tracked
  component(s) currently hold them. Excluded only when it dies (no living
  cells of that lineage left, surfacing as a non-finite feature) -- a
  component fission or fusion event never excludes a genetic cluster by
  itself, since the cluster was never tied to any one component
  (tools/individuality.ts's `geneticActive`/`geneticHistory`).
- **component**: the single tracked individual holding a strict majority of
  a founder's living lineage mass at window start (not a candidate at all,
  distinct from "excluded", if no component holds a majority that world).
  Excluded the moment that specific tracked individual fissions (as the
  event's parent), fuses into another individual (as the event's child), or
  dies -- the only one of the three kinds whose eligibility is tied to
  component-tracker identity at all (tools/individuality.ts:293-300).
- **colony**: the founder clusters linked (>=3 members, >=2 clusters) at
  window start; its mask thereafter is the fixed union of those clusters'
  own masks, decoupled from both collective-tracking and component-tracking
  machinery -- excluded outright the moment any one constituent cluster has
  no living cells left, never silently shrunk to its survivors. Like the
  genetic cluster (and unlike the component), a colony is defined at the
  cell/lineage level, so a component fission or fusion event never excludes
  it by itself.

## 5. Results of the small run

```
deno run -A tools/individuality.ts --worlds 12 --window-start 600 \
  --window-steps 150 --tile 64 --founders 6 --seed 1 --calibration-worlds 4 \
  --out runs/individuality/real8
```

12 analysis worlds (seeds 1..12) plus 4 calibration worlds (seeds
900000002..900000005, `CALIBRATION_SEED_OFFSET=900000001` added to
`--seed`), T=149 per analysis world (149/1728 of the per-world floor at the
default profile -- see §3; running more worlds does not raise this, it only
sharpens the mean across worlds), founder genetic clusters 0..5, default
profile `|S|=12 |E|=6`. Independent runs with identical arguments produce
byte-identical `report.json`/`report.md` (every resampling step is seeded
via `mulberry32`, never `Math.random`); this held again after the M3
founder-set update to 12 founders/cluster 23 dropped
(`packages/schema/src/founders.ts`), since founders 0-5 (the ones this run
uses) kept the same genomes -- rerunning post-update reproduced this
section's numbers exactly. Of the 36 anchor x profile
bin fits this run performs, 12 used that exact anchor's own calibration-world
histories and 24 fell back to the pooled-all-calibration-anchors bins (§3);
genetic-cluster 1 and 3 in particular had 0 eligible calibration worlds each
(their founder lineage died out early in every one of the 4 calibration
replicates too), so both rows are fully global-fallback-binned in addition
to resting on only 2-3 analysis worlds. Holm correction is computed across
all 54 cross-world-null tests this run performs (9 aggregates x 2 profiles x
3 null-tested quantities); the table below shows only the default-profile
`nonClosure` column of that family. A range marked "uncalibrated" below has
fewer than `MIN_CALIBRATED_WORLDS=8` eligible analysis worlds (§3) and is a
descriptive resampling range, not a confidence interval.

| kind | id | worlds | excluded | autonomyStar (point, CI/range) | nonClosure (point, CI/range, p, Holm p over all 54 tests) |
|---|---|---|---|---|---|
| genetic-cluster | 0 | 12 | 0 | 0.482, [0.297, 0.675] | 0.029, [0.009, 0.054], p=0.534, p_holm=1.000 |
| genetic-cluster | 1 | 3 | 9 | 0.000, [0.000, 0.000] (uncalibrated) | 0.000, [0.000, 0.000] (uncalibrated), p=1.000, p_holm=1.000 |
| genetic-cluster | 2 | 12 | 0 | 0.261, [0.139, 0.404] | 0.025, [0.010, 0.045], p=0.296, p_holm=1.000 |
| genetic-cluster | 3 | 2 | 10 | 0.000, [0.000, 0.000] (uncalibrated) | 0.000, [0.000, 0.000] (uncalibrated), p=1.000, p_holm=1.000 |
| genetic-cluster | 4 | 12 | 0 | 0.655, [0.417, 0.913] | 0.038, [0.016, 0.066], p=0.004, p_holm=0.238 |
| genetic-cluster | 5 | 12 | 0 | 0.744, [0.430, 1.054] | 0.077, [0.049, 0.106], p=0.145, p_holm=1.000 |
| component | 4 | 7 | 5 | 0.953, [0.537, 1.338] (uncalibrated) | 0.042, [0.015, 0.073] (uncalibrated), p=0.071, p_holm=1.000 |
| colony | 0,2,4,5 | 4 | 8 | 0.374, [0.000, 1.030] (uncalibrated) | 0.005, [0.000, 0.008] (uncalibrated), p=0.375, p_holm=1.000 |
| colony | 0,1,2,4,5 | 6 | 6 | 0.247, [0.090, 0.397] (uncalibrated) | 0.000, [0.000, 0.000] (uncalibrated), p=1.000, p_holm=1.000 |

(components 0/1/2/3/5 and four single-world colony compositions cleared
fewer than 2 eligible worlds, excluded, not shown -- for these, `worlds`
being 0 means no world both had a candidate at window start AND kept it
intact for the full window; the aggregated count alone cannot tell those
two reasons apart, e.g. it does not establish that founder 0's component
never held a window-start majority, only that none of its worlds produced
an eligible row. Likewise "excluded" above sums worlds where an anchor was
never a candidate at window start with worlds where it was one but died,
fissioned or fused before the window ended, or -- for a colony -- never
formed at all; §4 breaks down which of those a given kind can even suffer,
but this run does not distinguish them from each other in this count.)

`autonomyStar` point estimates for the 12/12-world genetic clusters (0, 2, 4,
5) run roughly 0.26-0.74 bits, all with intervals excluding 0 -- mass,
membrane fraction and photo-share are slow-moving, so an excluding-0
`autonomyStar` CI is expected self-predictability, not individuality
evidence by itself. Genetic-cluster 1 and 3's `autonomyStar`/`nonClosure` are
both pinned at exactly 0: with 0 eligible calibration worlds for either (see
above), their symbols come entirely from bins fit on the general
calibration-wide feature distribution, which their own chronically small,
narrow-range histories apparently map into a single symbol throughout each
eligible analysis world -- a genuine reading given the bins actually in
force, not a computation error, but one further weakened by both the small R
(2-3) and the global-fallback bins. Genetic-cluster 3 (R=2, exactly `2!=2`
possible permutations) shows the honest resolution floor described in §3: its
raw `nonClosure` p is exactly `1.0` (its own corrected `nonClosure` is 0 in
both eligible worlds, so no permutation can rank as more extreme), the upper
end of, not an exception to, the `1/R!` floor.

**Nothing in the default-profile column above clears `p_holm<=0.05`.**
Looking at the full 54-test family (both profiles), the smallest `p_holm` is
genetic-cluster 4's *default*-profile PID `synergy` (raw p=0.0015,
`p_holm=0.081`) -- close, but it does not clear the declared 0.05 threshold.
The next-closest is the same row's default-profile `nonClosure` shown in the
table above (`p_holm=0.238`); every coarse-profile result for this row is
far from significant (PID `synergy` `p_holm=1.000`, `nonClosure`
`p_holm=1.000`), the reverse pattern from the default profile being the
weaker one. Component 4's default-profile `nonClosure` (`p_holm=1.000`,
raw p=0.071) is the only other row under `p_holm=1` worth naming, and it
does not come close either. genetic-cluster 4 is the best-supported row
overall (12/12 worlds, present in every one of the closest results), but no
test in either profile clears Holm at 0.05 in this run.

## 6. What would count as a higher-level individual

A colony spanning >=2 genetic clusters whose `autonomyStar` CI is clearly
above 0 **and** whose `nonClosure`/PID pattern clears its cross-world null
differently from its member components/genetic clusters -- not merely
inherited from combining already-coupled parts. Neither of this run's two
best-supported colonies has enough eligible analysis worlds to evaluate the
first criterion with a calibrated interval at all: `0,1,2,4,5` (n=6) and
`0,2,4,5` (n=4) are both below `MIN_CALIBRATED_WORLDS=8` (§3), so their
`autonomyStar` numbers above ([0.090, 0.397] and [0.000, 1.030]
respectively) are descriptive resampling ranges, not confidence intervals --
this run cannot say either one "clearly" excludes 0, only that their point
estimates (0.247 and 0.374) are positive and their raw resampling ranges
happen to as well. Neither colony clears the second criterion regardless:
`0,1,2,4,5`'s `nonClosure` is non-significant (p=1.000, p_holm=1.000, its
corrected `nonClosure` point estimate is exactly 0 in this run), and
`0,2,4,5`'s (p=0.375, p_holm=1.000) is not close either. A firm answer to
either criterion for a colony this small would need either a much larger
`--worlds` (to reach `MIN_CALIBRATED_WORLDS` in a composition this rare) or
a colony composition common enough to be eligible in >=8 analysis worlds at
this scale. Mirrors `collectives.ts`'s own `heritability` signature
(composition resemblance across a collective fission), already implemented
for M7.

## 7. Held-out status

This observable is descriptive only. It is not read by `tools/bootstrap.ts`,
`packages/search`, or any environment/search objective, and must not become
one -- matching `docs/plan.md`'s "held out" discipline for ecology/multilevel/predictive-information measures.
