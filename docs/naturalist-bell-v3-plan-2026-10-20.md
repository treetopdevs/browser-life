# Anomaly bell v3: acute paired detection (2026-10-20)

Status: **proposed preregistration; no pilot or experimental jobs launched**. This
file and the CPU measurement kernel are reviewable preparation, not a result or
an execution-ready launcher. Freeze the approved protocol, implementation commit,
configuration identities and seed audit in a registration manifest before any new
pilot or scored output. No GPU run or paid-model evaluation is authorized here.
Historical v1 and v2 documents and records remain unchanged.

## Evidence and choice

Sources at repository base `3f44c3197dd485d70998d5f1de63abd29f598eb0`:

- [v1 protocol/readout](naturalist-bell-v1-plan-2026-10-17.md), especially B and
  “Healing within the window”; `experiments/naturalist/bell-v1-twins.json`.
- [v2 protocol/readout](naturalist-bell-v2-2026-10-18.md);
  `experiments/naturalist/bell-v2-twins.json`.

V1's frozen thirteen-signal twin rule detected L96 and feed on 4/10 each.
Its eleven-signal rescoring (L96 10/10, feed 8/10, held-out nudge 1/10 at
2.580695652173913) was post-hoc. V2 prospectively tested that hypothesis:
all 70 jobs valid, all ten replay controls exact, but L96 4/10 and feed 2/10
at the fresh nudge maximum 6.036; held-out nudges 0/10. At the old threshold,
feed was 7/10 and held-out nudges 3/10. Neither is replication. V2's exploratory
rank effects 0.94 and 0.91 show separation, not a successful detector.

| Consideration | Nudge-difference units, retaining persistence | First census only, retaining v2 units |
| --- | --- | --- |
| Sensitivity rationale | Between-world spread may dwarf within-pair perturbations; v1 explicitly identifies this mismatch | V1 directly reports L96 living-cell z of −4.0 to −6.9 at S+100 weakening to window D of 0.9–5.2 during healing |
| Main limitation | Changing units cannot recover an acute difference erased by a window minimum | Feed develops later: v1 pilot had only +5 cells initially, then about +3,000; v2 feed hits started at 201400 and 204600 |
| False positives | Small/zero nudge scales amplify noise; late chaotic nudge divergence remains in the window | Removes searching 50 start times and excludes later chaos; removes persistence protection against transient noise |
| Control dependence | Nudges determine both per-signal units and threshold; estimator, pooling over time, floors and calibration split all need new choices | Nudges determine only the scalar threshold; the ten bases still determine signal units |
| Cross-seed reproducibility | Ten nudge pairs poorly estimate eleven heterogeneous scales/tails; normalization need not improve rank separation | One fixed time and inherited units reduce new choices, but seed-dependent ecology and the max-of-ten null remain |

**Recommend first census only.** This is a narrower test of the documented healing
mechanism with fewer new fitting choices. It is not evidence that v3 will pass.
V2 first-difference times prove divergence exists at S+100, not that the chosen
signals distinguish events from nudges there. Neither committed score record
contains the full first-census eleven-signal vectors needed to reconstruct this
endpoint. We have not rescored raw historical bundles, selected a winning time,
or estimated a v3 success rate. The scientific comparison above is interpretation
of historical evidence, not preregistered evidence for v3.

Nudge-unit designs remain a later alternative: specify a robust scale of signed
pair differences, nonzero physical floors, an independent scale-fitting corpus
and separate threshold calibration before trying one. Reusing ten nudges for both
scale estimation and thresholding introduces dependence; simply dividing each
signal by its nudge maximum does not guarantee better event/null separation.
Do not run both candidates and select a winner under this registration.

## Frozen candidate measurement

Question: in gradient-m3 treatment worlds with a matched replay twin and known
intervention step, can the **acute** response distinguish L96 and feed from a
five-site lesion? This is not a single-world bell, an unknown-time detector,
a test of lasting ecological change, or a general intervention classifier.

- S = 200000; census every 100; deep every 10. The only scoring census is
  **t = 200100**. Intervention occurs after the census at S, unchanged.
- Keep exactly v2's eleven signals and floors: livingCells, individuals, meanMass,
  lineages (floor 1); lineageShannon, patternEntropy, bioticRecycling (0.01);
  fissions, fusions, buddings, mutations (1). Exclude maxGeneration and dominantShare.
- Each rate is its own run's cumulative counter at 200100 minus at 199100,
  not the previous census and not a rate estimated from another run.
- For each signal, take the ten base values at t, including the matched base.
  Let u_s = max((Q75−Q25)/1.349, 0.05 abs(median), floor_s), using v2's
  linear interpolated quantiles. z_s = (twin_s−matched_base_s)/u_s.
- D = max_s abs(z_s). No persistence, later census, alternative window, matter
  channel, arm-specific direction or threshold enters this maximum. Preserve
  signed z, units and all eleven raw base/twin values as receipts. Ties use signal
  table order. Rates keep the inherited 1000-step lag to isolate the time change.
- Z3 = max D over the ten calibration nudges only. A hit is **D > Z3**, strictly.
  No historical threshold, percentile substitution, cap on an outlying nudge,
  positive threshold floor or tuning after inspecting results. If Z3=0 the same
  strict rule applies; report it prominently.
- A missing, nonfinite or undefined kept input voids that job; never coerce it
  to zero. Missing/invalid bases or calibration nudges prevent every call.

## Corpus, controls and validity

Ten new base histories, with five forks per base: sham, calibration nudge,
held-out nudge2, L96, feed. **60 scored jobs**; omit L64 completely. Same arms,
centres, radii, amounts and toroidal tie-breaking as v2: L96 at (128,128),
feed r32/64 quanta at (128,128); r1 nudges at nearest biomass to (128,128)
and (64,64), respectively. Both nudge centres come from the verified sham's
pre-intervention checkpoint at S and are frozen before nudge forks run.
If centres coincide, retain and report them; nudge2 then supplies less independent
information, never move it after inspecting outcomes.

Shams test replay correctness, not a nontrivial statistical null. Nudges are the
calibration null; nudge2 tests geographic transfer of the small-perturbation null.
They share histories and are not independent draws across arms. No calibration
zero is reported as a held-out false-alarm result.

Candidate seeds: 58001–58010; mechanics pilot 58000; ordered replacements
58011–58020. These are reservations, **not certified fresh**. Before registration,
audit all committed experiment/config seed declarations, all accessible run
bundles, other worktrees and the owner's bench/private output roots, including
non-gradient runs. Record search scope, unavailable roots and exact seed list.
If freshness cannot be established, stop; choose and commit an unused block
before any v3 simulation. No selection using ecological or score outcomes.
No v1/v2 world or pilot enters scoring, calibration or the base unit.

Use v2's conservative execution horizon unchanged: bases step 0–206000,
checkpoint C=190000; forks C–206000 (16000 steps). This retains mature-world
mechanics and validity code, even though D reads only S+100. No lineage observer
flag; stitch base censuses through C, then each fork's own censuses. Rates' lagged
censuses lie after C. Require every v2 manifest, preset identity, launch-log,
checkpoint hash, intervention receipt, exact cadence and strict lineage-count
check; additionally validate all eleven raw signal fields before extraction
(the legacy extractor maps absent fields to zero). Bases have 2060 censuses,
forks 160. Every non-sham must differ after S and every fork must exactly match
its base in series and lineage rows through S. All ten shams must match through
206000. Do not shorten a replay check because scoring ends earlier.

Only a base extinct at S is replaced, determined before its treatment forks;
small bases stay. Replacements use the next reserved seed, at most ten total.
No replacement for unusual scores or technical invalidity. Exhaustion stops
with no call. One blind retry per nonzero job exit; preserve failed artifacts and
attempt logs. Successful jobs are never selectively rerun. Reuse v2's cumulative
retry/resume ledger and fail-closed cap semantics. A replay mismatch voids the
experiment; an incomplete/invalid primary corpus is **not called**, not negative.

## Acceptance and reporting, fixed before collection

All calls require a completed launch, ten valid bases, all ten calibration nudges,
all ten valid shams passing exact replay, and all ten valid twins in the arm read.
A complete positive result requires all 50 forks valid.

| Endpoint | Bar |
| --- | --- |
| Replay R | 10/10 exact shams across the full replay horizon |
| L96 sensitivity | at least 8/10 D > Z3 |
| Feed sensitivity | at least 8/10 D > Z3 |
| Held-out false alarms | at most 2/10 nudge2 D > Z3 |

Both sensitivity bars plus held-out bar met: “acute paired detector met the v3
bar on fresh seeds.” Only one sensitivity bar met: “detects [arm] only”; no joint
success. Neither met with held-out bar met: negative sensitivity result.
Held-out bar missed: “threshold did not transfer,” irrespective of sensitivity.
No pooling with v1 or v2, no rescue by secondary thresholds or delayed windows.

Report per seed/arm D, z vector, units, winning signal/side, centre, dose, validity,
replacements, retries, resource ledger, Z3 and its setting seed/signal. Report exact
one-sided 95% binomial bounds per arm, plus medians and rank effects as exploratory
only. With n=10, 8 hits has a lower bound about 0.49, and even zero false alarms
has an upper bound about 0.26. At true sensitivity 0.8 the probability of at least
8/10 is about 0.68 per arm. A max-of-ten threshold has an uncertain tail (under
exchangeable independent continuous nulls a new exceedance has marginal chance
1/11); geographic nudge differences and shared histories weaken that idealization.
The experiment cannot certify a population false-alarm rate below 10% or broad
cross-seed generality. Publish failure and invalidity with the same detail as success.

## Resources and implementation boundary

One local GPU job at a time, no models/network evaluation. Total **5 wall-clock
hours**, including pilot, GPU waits, retries and every resume; pilot at most 1 hour
within that budget. At least 2 GB free at every job start. Use v2's GPU-user check,
projection factor 1.25 and slower-of-pilot/observed-job projection, cumulative
heartbeat/orphan accounting, child alarm, symlink protections and absent-destination
checks. Fresh external output root `~/browser-life-bell-v3/`; never overwrite v1/v2
or repo runs. Freeze actual absolute root in the run manifest.

Pilot: same five mechanics jobs as v2 on 58000 (16000-step base, checkpoint 10000;
6000-step sham/L96/feed/nudge forks; intervention 15000). It tests timing/replay,
not scientific tuning. Budget is at most 40 main/replacement base attempts
(20 distinct bases, two attempts each), 100 fork attempts (50 forks, two each),
and five pilot jobs, each at most two attempts. Normally 60 main jobs plus five
pilot jobs; approximately 2.86 million main steps without replacement/retry.
Stop before another attempt if its projected end exceeds the remaining budget;
kill an active child at the cap. No arm/seed-count/horizon reduction to fit:
cap exhaustion means incomplete/not called. No automatic budget increase.

**Framework assessment:** `tools/run.ts` already supports these interventions,
checkpoint forks, census ordering and observer restoration. `bell2.ts` has
stitching, replay/manifest checks and resource-ledger helpers. No dynamics,
checkpoint encoding/semantics or golden pins need to change. `PairScorer` itself
hardcodes ten-census windows; changing it would risk historical reproduction.
`tools/lib/bell3.ts` therefore adds a separate CPU-only measurement kernel that
reuses the signal table and quantile/spread routine. It accepts already extracted
vectors and refuses wrong times or invalid kept values. Its tests are synthetic
implementation evidence, not simulation results.

The v2 launcher/scorer are version-specific (seeds, names, six arms, job IDs,
record schemas and eligibility), so **do not invoke them as a v3 launcher**.
Before execution, implement a v3-specific adapter/planner and CLI that reuse the
reviewed primitives, validate raw fields before SignalExtractor, stream bundles,
record the endpoint receipts and enforce this registration. Add CPU integration
tests for rate lag, stitched forks, invalid raw fields, all acceptance/not-called
branches, fresh-seed audit, resource caps and immutable v1/v2 reproduction.
Pin code/config identities and the registration hash; reject mismatches at launch
and scoring. Review that adapter before any pilot. This focused change deliberately
provides no launch command and cannot accidentally start a GPU experiment.
