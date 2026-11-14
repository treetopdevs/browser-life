# Mycelium world, rung R4: is the kept trail used, or only paid for? (protocol, 14 Nov 2026)

Status: written before any logged run. Everything is local and uncommitted, run on native WebGPU on one Mac. The `/mycelium/` page is not touched. Rule id `mycelium-r0`. The kernel (`tools/mycelium/world.ts`, `gpu.ts`) is the one at commit `e5b43f69` (the optional trail-use rule on top of R3's `eef9c043`), unchanged; section 9 checks its hashes. R4 follows R3's template (`docs/mycelium-r3-2026-11-13/`): readouts defined at zero trail, attainability before the confirmation, two freezes, a seed log, an independent Python re-derivation, CPU cross-checks.

## 1. The question

The trail-use screen (`docs/mycelium-trail-use-2026-11-13/SCREEN.md`, exploration, 4 seeds a cell) found that under the **toll rule** at `moveCost` 12, `trailMoveDiscount` 64 (a movement discount on the start-of-step trail in the particle's own cell, only for a particle whose deposit request is positive), the inherit arm kept about 99 trail per particle in 4 of 4 seeds, with the mean deposit at one unit per particle per step. It also noted that the state sits at the lowest deposit a controller can ask for in steady state, so it may be only the minimum toll payment, that blocked rises too, and that nothing measured whether particles *use* the trail.

> **Question.** Under the toll rule (`moveCost` 12, strength 64), is the kept trail **functional**, meaning evolved controllers act on the trail *gradient* (their movement follows it, they gather on it, and their outputs depend on the gradient inputs), or is it **toll only**, meaning each particle lays the one unit that buys the discount and the controllers show no such use?

The claims are exactly as wide as the readouts: directional alignment with the local trail gradient, concentration of particles on trail, the signed acute change in alignment when the two gradient inputs are zeroed, and the general dependence of the five used outputs on those two inputs. They do not cover use of the local trail *level* (input 2), nor anything else a controller might do with trail that none of these see (section 10).

R4 does not test heredity against a null (R2b's question), does not measure selection (R3's was a direction test), and says nothing about structure, individuality or open-endedness.

**What the design predicts, written before any R4 run (a prior, not a finding).** With the toll at 64, a cell holding 4 or more units of trail gives the full discount (`min(P, 256) x 64 >= 256`), and the kept state holds about 99 per particle, so almost every particle stands where the discount is already complete. Following the trail then buys no further discount. The shaping runs of section 2 agree: the fraction of particles standing on a complete discount is about 0.999. So the design expects **toll only** or a small trace of use, and FUNCTIONAL has to come from information use alone. FUNCTIONAL stays reachable (section 8 shows it). The shaping runs also showed a small positive ALIGN difference between inherit and blind (about +0.05 against an anchor span of about 1.1), which is why MINOR-USE is a named outcome.

## 2. Arms, slots and seeds

All arms are `defaultConfig()` (128 x 128, 1,024 founders, cap 8,192) plus the delta below. Only existing config keys are used and `defaultConfig()` is unchanged, so every earlier digest and pin is untouched.

| arm | delta | role |
|---|---|---|
| inherit | `moveCost` 12, `trailMoveDiscount` 64, `trailDiscountMode` "toll" | the toll world; the arm in question |
| blind | the same, plus `blindTrailGradient: true` | the **evolved lesion**: the trail-gradient inputs 3 and 4 are zero for every particle for the whole run, so a controller can evolve to use everything except the trail gradient |
| physarum | the same toll, `heredity: "frozen"`, `controller: "physarum"`, `physarumDeposit` 256 | the **anchor**: a fixed trail-following rule at a matched deposit; the full-use reference and the positive control of the readouts (section 5) |
| blocked | the same toll, `heredity: "blocked"` | descriptive: fresh random controllers at every birth. It checks that the acute readout sits near 0 for controllers that cannot have been selected for trail use. It is not an "inherit minus heredity" baseline (R2b RESULT.md) and is not in the label |
| keyless | `moveCost` 12, no discount keys | the no-benefit baseline. It replicates that the toll is what keeps the trail (retention, trail mass, population, turnover). It is **not** a baseline for the use readouts: it keeps trail in some runs (1 of 3 in the shaping runs, with unrelated alignments), and in the runs that lose it the use readouts are the defined-at-zero values |

Dropped on purpose: public-mode discounts, other strengths and other `moveCost`s (the screen is exploration and the question is about its suggested rung), a toll-only-no-deposit-floor arm (the kernel offers no such key and may not change). The keyless arm is kept because without it a kept trail could not be attributed to the toll.

**Slots and world seeds.** A *slot* is the registered label of a run. The world seed in the config is `slot + offset(arm)` with offsets 130,000 (inherit), 140,000 (blocked), 150,000 (physarum), 160,000 (blind), 170,000 (keyless) (`tools/mycelium/r4-seeds.ts`). So no two arms share founders or a PRNG stream, and every world seed is far above 9001 (`run.ts` refuses seeds from 9001 up, `r2.ts` confirm takes 9001-9005 only), above R2b's (at most 55,016), R2's, R3's (60,001 to 126,016), the screen's (8001-8004 and 108001-108004) and the shaping scratch worlds' (200,011 to 240,013).

- **Dev** (generates attainability and may shape thresholds; never part of the label): slots **8001-8020**, all five arms, 100,000 steps (100 runs). Slots 8001-8004 were the screen's slots: the screen's inherit worlds used world seeds 8001-8004, but R4's slot 8001 is world seed 138001 (inherit), a different world, so no screen run is an R4 run. The screen's results are dev-level information and shaped the design (sections 1 and 6).
- **Confirmation:** slots **7001-7016**, all five arms, 100,000 steps (80 runs). Never run before this protocol. The log refuses them outside the confirm phases, and a test reads the seed log and fails if a confirmation slot appears outside the confirm and cpu-check phases.
- **Shaping runs (disclosed, unlogged, outside every registered set):** before this protocol was written, 5 arms x 1 seed at 10,000 steps and 5 arms x 3 seeds at 100,000 steps were run on scratch world seeds (offsets 200,000-240,000 plus seeds 11, 12, 13) to see the size and spread of the readouts, using the registered readouts' code except that the 100,000-step runs predate the columns `alignBlind`, `acute` and `sensAll`. They showed: trail kept in 2 of 3 inherit runs (the third lost it before step 12,000 and stayed lost), 3 of 3 blind and 3 of 3 physarum runs; ALIGN of about -0.07 and -0.03 (inherit) against -0.13, -0.15 and -0.08 (blind) and +0.99 (physarum); OCC of 1.01 and 1.30 (inherit), 1.06, 1.26 and 1.03 (blind), 6.9 to 7.3 (physarum); the fraction on a complete discount about 1.000 in every kept run; deposit requests exactly one unit for 98-100% of particles. These numbers set the size of THETA (section 5) and were looked at once. No confirmation slot was run.

## 3. Runs

100,000 steps per run on the GPU (`GpuMycelium`), 128 x 128. Scalar census every 100 steps (ledger check: matter and energy residual exactly 0 and `validateState`, at every one of the 1,000 censuses; any nonzero residual makes the run invalid and stops the protocol), heavy census every 500 (R2b's deposit measure d, median age, and the R4 columns of section 4). The scalar and heavy series are R2b's own, read by `runValues`. One full-horizon CPU digest cross-check of a finished dev run and of a finished confirmation run, logged, is an acceptance gate exactly as in R3 (equal digests, the run file's digest, the frozen code hash); the dev gate requires one cross-check of a physarum run and one of a neural-controller run (section 8), the confirmation one of any arm. A batch or cpu-check takes an exclusive lock beside the canonical seed log, and the seed log refuses a second finished entry for a run, so a run is never repeated. Confirmation runs are batch-only and print digests only. Before a batch starts the runner reconciles the log with the files (a run the log calls finished is never repeated and its file must match the logged hash; a file with no finished entry is refused, even with no log entry at all), checks the log, the freezes and (confirm) the calibration even when nothing is left to run, and refuses a job count that is not a positive integer.

## 4. Readouts (all defined at zero trail and with no particles)

Decisions use the **late window L = (50,000, 100,000]**, the mean over its 100 heavy censuses of each per-census value below. A mid window (10,000, 20,000] is stored for trail mass only (descriptive). Per-census values are computed from the state with the kernel's `probe()` (the controllers' next-step outputs, no change to the state); the "blind" outputs come from `probe()` on a copy of the state whose config has `blindTrailGradient` true. gx, gy are the two trail-gradient inputs exactly as the sense phase builds them.

- **ALIGN**: the mean over particles that have a nonzero gradient and a nonzero intended movement (MX, MY) of the cosine between the movement and the gradient (gx, gy); 0 when there are none. +1 is following the trail uphill, 0 is no relation. **A baseline that is not 0:** in every shaping run with trail, ALIGN of a blind controller is about -0.1, because a moving particle lays trail behind it and the gradient at its cell points back along its path. So only contrasts mean anything.
- **OCC**: the mean trail in the particles' cells divided by the mean trail over the field; 1 when there is no trail or no particle. Particles lay trail where they stand, so OCC is above 1 for any depositor; it is a contrast quantity too. (`occShift`, the same with every particle displaced half the torus, is stored for description.)
- **ACUTE**: the acute lesion. For each particle with a nonzero gradient, cos(movement) minus cos(movement when the two gradient inputs are zeroed), a zero movement counting cosine 0; averaged over those particles; 0 with none. It is a within-state measure of how much the controller's movement depends on the gradient inputs *now*. It is exactly 0 in a blind arm (the lesion is already there) and about +1 for the physarum rule (blind it wanders).
- **SENS**: the general dependence of the controller on the two gradient inputs: the mean over particles of the summed absolute change of the five used outputs (MX, MY, EAT, DEPOSIT, SPLIT) when the inputs are zeroed, divided by 5 x 254. It is never negative, is exactly 0 in a blind arm, and is about 0.09 for the physarum rule (only MX and MY change). It catches dependence that changes speed, eating, splitting or depositing without changing the direction of movement, which ACUTE (a signed change of an angle) cannot see.
- **Floor and mechanism columns:** `req1` and `req2p`, the fractions of particles whose deposit request `(maxDeposit x relu(DEPOSIT)) >> 7` is exactly 1 and 2 or more (`req0` for 0); `sat`, the fraction standing where the discount is complete; `speed` and `speedBlind`, the mean (|MX| + |MY|)/254 with and without the gradient inputs; `alignBlind`, `sensMove` (the movement part of SENS) and `sensDep` (the fraction whose deposit request changes) (descriptive).
- **Life history (R2b's):** `d` (the deposit measure), mean population `n`, turnover, median age; and `tmL`, trail mass per particle (the mean over the window's scalar censuses of sum P / n, 0 when n = 0). Median age and turnover are undefined when no particle lives through the window; such an (extinct) run is stored with 0 for both, `tmL` 0 and the population guard tripped, so it counts in retention and in the guard.
- **In the toll state:** a run is in the toll state when `tmL >= 10`. In the shaping runs the kept state sat near 99 per particle, a lost one near 0. The use readouts are compared **among runs in the toll state** (in a run that lost its trail ALIGN and OCC are the defined-at-zero values and say nothing about use). Selecting on `tmL` is selecting on an outcome, so retention (the count of runs in the state) is reported and tested separately (section 6). The in-state contrasts are survivor-conditioned: they describe worlds that kept the trail and are **not** causal effects of the lesion among a common set of survivors, whatever the retention counts are.

Every readout is a deterministic function of the stored series (`observe-r4.ts`, `r4-decide.ts`); the analysis recomputes each from the series and refuses a run file whose stored readout differs.

## 5. The anchor, and what "not explained by the physarum null" means here

The physarum arm runs a fixed rule: up the trail gradient at half speed plus a small random turn, deposit exactly one unit per step (`physarumDeposit` 256 gives `DEPOSIT` 32, request 1, with no draw), always eat, always split. It follows the trail *by construction*, so it cannot "explain away" evolved use; its roles are:

1. **The full-use anchor and the fixed margins.** The span of a readout is the median over in-state runs of physarum minus the median over in-state runs of blind (ALIGN, OCC), or the median of physarum's own value (ACUTE, SENS: a blind counterpart is 0). The margins are THETA = **0.15** (`R4.THETA`) times these spans **computed once, on the 20 dev runs per arm, at calibration**, stored as numbers in `CALIBRATION.json` (which Freeze 2 hashes) and used unchanged by the confirmation. So the confirmation's intervals are compared with fixed numbers, not with a margin re-estimated from the same data. "No use" means inside +-15% of what a plain gradient follower showed on dev; "functional" means above it.
2. **The positive control of the readouts (gate G).** Evaluated on the confirmation data too: physarum must exceed blind on ALIGN and OCC with Cliff's delta at least 0.9, with `spanAlign >= 0.5`, `spanOcc >= 1.0` and `acutePH >= 0.5`. If not, the readouts cannot see use at all and the label is INCONCLUSIVE. The shaping runs show spans of about 1.1 (ALIGN) and 6 (OCC) and an acute effect near 1, so the gate is attainable; section 8 requires it on dev data.
3. **The matched deposit (gate MATCH).** `physarumDeposit` is fixed now at **256** (1/256 matter per particle-step, one unit a step): the screen's toll-64 inherit worlds had a late deposit measure d between 0.996 and 1.015, and the shaping runs 0.997-1.015, so matching at 1.0 is attainable by construction (R2b failed at a 1/16 floor above every arm's rate; here the target is 1 and the floor is irrelevant). Calibration requires the median realised late d of in-state physarum runs to be within **+-10%** of the in-state inherit median on dev (`R4.MATCH_BAND`); confirmation reports it. Population is not matched (physarum's is lower, about 2,500 against about 4,300 in the shaping runs) and is reported, not adjusted.

## 6. The label

**The tests.** Among runs in the toll state, inherit against blind, late window:

- **U1, ALIGN** and **U2, OCC**: two-sided Mann-Whitney (exact without ties, the fixed-key permutation Monte Carlo with ties, as `r2b-stats.ts`), inherit against blind, one Holm adjustment over the two p-values at alpha 0.05. Each also gets the Hodges-Lehmann shift (inherit minus blind) with a 95% percentile bootstrap interval (`effectSize`, 10,000 resamples).
- **A1, ACUTE** and **A2, SENS**: inherit's own value: the median over in-state inherit runs and its 95% percentile bootstrap interval (a fixed-key one-sample bootstrap, 10,000 resamples). The blind counterpart is 0 by construction, so there is no two-sample test.

**Margins:** the fixed numbers of section 5, `m_ALIGN`, `m_OCC`, `m_ACUTE`, `m_SENS` (0.15 x the dev anchor), read from `CALIBRATION.json`.

**Status of each endpoint.** Let `m` be its margin and `d = 0.25 m` its detection floor (`R4.DETECT`): a random controller's dependence on inputs it was never selected on is small but not exactly 0, and a difference below a quarter of the margin is not counted as a trace of use. In this order:

- **USE**: ALIGN, OCC: Holm rejects, Cliff's delta (inherit above blind) at least **0.5**, and the **95% interval above `m`** (so "at least 15% of the anchor" is established, not just a point estimate above it). ACUTE, SENS: the 95% interval above `m`.
- **SMALL**: ALIGN, OCC: Holm rejects, delta at least 0.5, and the interval above `d` and below `m`. ACUTE: the interval above `d` and below `m` (and above -`m`). SENS has no SMALL (it is never negative, and a random controller shows a small positive value), only USE and EQUIV.
- **WRONG** (the opposite sign): ALIGN, OCC: Holm rejects, delta at most -0.5, and the interval below -`d`. ACUTE: the interval below -`d`.
- **EQUIV**: the interval lies strictly inside (-`m`, +`m`) and none of the above holds (ALIGN, OCC: a rejected shift below `d` is EQUIV); SENS: the interval's upper end below `m`.
- **UNRESOLVED**: anything else (the interval is too wide to say).

**The floor (mechanism):** among in-state inherit runs, the median `req1` is at least **0.8**, the median `req2p` at most **0.1**, the median `sat` at least **0.9**: particles pay the minimum toll, and the discount is complete where they stand.

**Retention:** the counts of in-state runs in inherit and in blind, Fisher exact two-sided; "a difference is detected" is p < 0.05. Passing it means *no detected difference*, not equivalent retention (at 16 runs 16/16 against 12/16 gives p = 0.10 and is not detected). It is a warning test: the in-state contrasts remain survivor-conditioned either way (section 4). Also reported: keyless and blocked retention.

**Gate S:** at least **8** in-state runs in each of inherit, blind and physarum; otherwise the readouts are not read and the label is INCONCLUSIVE.

**The full outcome table** (A = ALIGN, O = OCC, C = ACUTE, S = SENS):

| condition (after gates S and G) | label |
|---|---|
| A, O, C and S all USE | **FUNCTIONAL** (the controllers act on the trail gradient: their movement follows it, they gather on it, their outputs depend on the gradient inputs, each with a 95% interval above 15% of what a plain follower showed on dev) |
| A, O, C and S all EQUIV, the floor holds, no retention difference detected | **TOLL-ONLY** (no gradient use above 15% of the dev anchor on any endpoint; the state is the minimum toll on a complete discount) |
| every endpoint EQUIV or SMALL with at least one SMALL, the floor holds, no retention difference detected | **MINOR-USE** (a detectable trace of use that is provably under 15% of the anchor on every endpoint, on a state that is still mainly a toll) |
| any WRONG | INCONCLUSIVE (reason: inverted, inherit below blind) |
| a mix of USE with anything else, or any UNRESOLVED | INCONCLUSIVE (reason: the endpoints disagree or the intervals are too wide) |
| every endpoint EQUIV or SMALL but the floor fails or a retention difference is detected | INCONCLUSIVE (reason: no use above the margin, but the state is not the plain toll, or the lesion changes retention) |
| gate S fails | INCONCLUSIVE (reason: too few runs kept the toll state) |
| gate G fails | INCONCLUSIVE (reason: the anchor shows the readouts cannot see use) |

INCONCLUSIVE is not FAIL. Every cell of the table has a label. **Population guard** (R3's): a run with n < 200 at any scalar census of the late window is flagged and kept; the label is also computed without the flagged runs and must agree, or it is INCONCLUSIVE. **INVALID** (an integrity failure, not a scientific label): any ledger residual, a run file that does not match its seed-log hash, readouts or config that do not recompute, a code hash other than the frozen one, a missing run, a log with a leak, a wrong-phase slot, a malformed, out-of-order or invalid entry, or a finished entry without its hash or digest, a kernel file other than the `e5b43f69` one, margins missing from the calibration, or a calibration that is not READY.

**Descriptive, not in the label:** the secondary lesion contrasts (inherit against blind among in-state runs on `n`, turnover, median age, `d`, `tmL`, `speed`: Cliff's delta and raw p); blocked's ACUTE and SENS (a check that random controllers sit near the no-use values); retention of keyless and blocked; the matched-deposit quality; `occShift`.

## 7. Integrity gates

Ledger residual 0 at every census; the population guard; provenance (section 9); the two CPU cross-checks; the seed log and the embargo. No readout is gated on a positive control except through gate G, which the calibration shows attainable.

## 8. Calibration and attainability (before confirmation)

After the 100 dev runs, `r4-analyze.ts calibrate` fixes the margins (section 5) and writes them with the verdict to `CALIBRATION.json`. The gate is attainability applied to the decision code, at the confirmation's settings (10,000 bootstraps; the Mann-Whitney Monte Carlo of the synthetic samples, which have ties, uses 100,000 permutations; the real data have none and are exact). Every number is fixed now. READY needs all of:

- **Integrity:** the 100 dev runs pass section 7, and the dev CPU cross-checks passed: at least one on a physarum run and one on a neural-controller run, each with the log's digest, the cpu-check file's CPU digest, its GPU digest and the run file's digest all equal, at the full horizon, under the frozen code hash.
- **Gates S, G and MATCH hold on the real dev data** (20 runs per arm), and **the floor holds on the dev inherit runs** (else TOLL-ONLY and MINOR-USE are unreachable).
- **FUNCTIONAL reachable on real data:** with the in-state physarum runs also entered as the inherit arm, the decision gives FUNCTIONAL.
- **Planted effects.** Datasets of 16 per arm resampled from the dev pools (fixed keys, 100 replicates). The use readouts of a synthetic inherit run are donated only by runs in the toll state of the blind, physarum and blocked arms (the comparison is among such runs). The inherit arm keeps a real inherit run's retention, floor columns and life history, and its ALIGN and OCC are blind + lambda (physarum - blind); its ACUTE and SENS are a blocked run's value (random controllers never selected on the trail: the no-selection baseline of dependence on the two inputs) + lambda x physarum's. **lambda 0 is the explicit joint no-use null.** Required, over 100 replicates each: FUNCTIONAL at lambda 0.5 at least **0.80**; TOLL-ONLY at lambda 0 at least **0.80**; FUNCTIONAL at lambda 0 at most **0.05**; MINOR-USE at the best of lambda 0.05, 0.075, 0.1 at least **0.50**; and the **boundary**: datasets in which every endpoint's true value is exactly its own fixed margin (ALIGN and OCC shifted by the margin from the blind draw, ACUTE and SENS centred on the margin) must show, for each of the four endpoints, "above the margin" (USE) in at most **0.10** of the datasets and "provably inside the margin" (EQUIV or SMALL) in at most **0.10**, and none of FUNCTIONAL, TOLL-ONLY, MINOR-USE above **0.10** (the 95% bootstrap interval must not cross the margin it is compared with). Rates at lambda 0.2 and 0.3 and at 0, 0.5 and 2 times the margin are reported.
- **Label permutation:** the inherit and blind dev readouts pooled and dealt back at random (100 deals): FUNCTIONAL at most **0.05**. This checks U1 and U2 only (inherit's own ACUTE and SENS travel with the runs); the joint null is lambda 0.
- **Small samples (reported, not gated):** lambda 0 and 0.5 and the all-at-margin boundary with exactly 8 runs in the toll state in each of inherit, blind and physarum, built by construction (the boundary of gate S).
- The rules are also applied to the real dev data and the label is reported, **not gated**.

Percentile-bootstrap coverage with 8 to 16 runs is not guaranteed by theory; the boundary requirement is its empirical check on the actual noise, and the small-sample rows show it at 8.

If calibration is not READY the protocol stops (MEASUREMENT-LIMITED) and confirmation is not run.

## 9. Freeze, provenance and amendments

`FROZEN` records, before any logged dev run (Freeze 1): the SHA-256 of this file, `code_hash` (SHA-256 of a manifest over the import closure of `r4.ts`, `r4-analyze.ts` and `r4-freeze.ts` under `tools/mycelium`, which includes `world.ts`, `gpu.ts`, `observe-r2b.ts`, `observe-r4.ts` and the R2b modules they import, plus `RULES.md`, `packages/schema/src`, `packages/sim-ref/src` and `deno.json`) and a per-file hash line for each. After calibration and before the first confirmation run (Freeze 2) one line appends `calibration_sha256`. The runner and the analysis verify both. **The kernel check:** `world.ts` must hash to `42f4bade799f82eee5df2c5bed410dede03e721348d8ffc32c62584f35c80242` and `gpu.ts` to `09126acfdf1614df9c6b5adaae6345e94a452bf5fb5375285ade7a962e512330`, their SHA-256 at commit `e5b43f69` (`r4-protocol.ts`, `KERNEL_SHA256`); `git diff HEAD` on `tools/mycelium/world.ts`, `gpu.ts` and `packages/` is empty. `r2b-decide.ts` is not called (open Sol P1 about mass-filtered Moran's I, which R4 does not use).

Any change to a hashed file or this protocol after Freeze 1 is a dated `## Amendment` below, with a reason that cites no confirmation result, a new Freeze 1, and a re-run of every dev run it affects. At most two amendments before the first confirmation run.

## 10. What each label would and would not show; limits

- Not shown, whatever the label: that the kept trail is *beneficial* or evolved *because* of what it does for movement (no lineage-level fitness is measured); anything about other strengths, other `moveCost`s, the public mode, other worlds or horizons; anything about spatial networks or mycelium-like form (Moran's I and connectivity are not read).
- The lesion blinds the two trail-gradient inputs only. **Use of input 2 (trail here, the local level) is untested**: a controller that slows, eats or splits by the local trail amount shows nothing in ALIGN, ACUTE or SENS (all three zero or change only the gradient inputs). OCC would pick up a concentration on trail, whatever its cause, but a null OCC does not rule out level-based use. TOLL-ONLY therefore means *no use of the trail gradient above 15% of a plain follower's*, not "nothing reads the trail".
- The evolved lesion (blind) and inherit may evolve different speeds or persistence, which move ALIGN and OCC mechanically; that is why ACUTE, a within-state contrast with an exact zero, is required alongside them. ACUTE and SENS zero inputs the controllers evolved with, which is off their training distribution, so they measure dependence, not purpose.
- The in-state comparison conditions on an outcome (whether the trail was kept). Retention is tested apart as a warning, but even equal retention would not make the survivors comparable, so the contrasts are descriptive of kept-trail worlds, not causal. The 8-run minimum of gate S is a power rule; calibration reports the labels at 8.
- The margin is a fraction of one anchor (a particular trail-following rule), so "15%" is relative to that rule's alignment, not an absolute behavioural scale.
- The planted datasets scale readouts by a constant fraction of the dev anchor; they show the code reaches the labels and at roughly what fraction of it, not that a real trajectory would be detected. The margins come from 20 dev runs per arm; their own sampling error is not propagated, which is the price of comparing the confirmation with fixed numbers.
- Per-census values come from stored series, not raw fields or genomes; one world (128 x 128, uniform light, 100,000 steps).

## 11. Review and analysis

Codex Sol 6.1 High read-only reviews precede Freeze 1 and the confirmation and follow the result. A second analysis recomputes every readout from the raw series in separate Python and compares. Sol's text is kept in the session scratchpad; the dispositions are in `RESULT.md`.

## Amendments

(none)
