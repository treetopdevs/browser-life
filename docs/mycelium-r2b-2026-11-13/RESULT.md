# Mycelium world, rung R2b: result (13 Nov 2026)

**Label: MEASUREMENT-LIMITED, at calibration. Confirmation was never run.** No PASS, NOT-SEPARATED or PHYSARUM-EXPLAINS exists. This is not a FAIL and it is not evidence about heredity in either direction. It is the outcome the protocol predicted in advance (`PROTOCOL.md` section 1, pilot and prediction; section 12, first bullet).

Everything here is local and uncommitted, run on native WebGPU on one Mac. Nothing is deployed and the `/mycelium/` page stays `noindex` and off the public site.

## The label, and who agreed

Two independent analyses were made after the 100 dev runs finished.

- **Analyst:** re-ran `r2b-analyze.ts calibrate --dry-run` (output equal to the stored `calibration-report.txt`) and `confirm --dry-run`, and re-checked run hashes, digests, ledger residuals, the population guard, the seed log and the evidence copies in separate Python.
- **Skeptic:** recomputed every readout (TM, medianTM, AGE, TURN, SIG, `d`, mean n, mean sum P, MI) for all 100 runs from the raw `series.json` files without using the analysis tools: 0 mismatches. It reproduced the exact Mann-Whitney tests, the Holm adjustment, the Otsu classifier, the MI validity count, the deposit target and the label order, then tried seven ways to refute the label.

They agree on the label, the kept set and every number below, so there is no more conservative label to choose. The skeptic could not refute it and found that INVALID is not triggered.

Rules that bind (PROTOCOL 6.3, 6.4, 6.7): the physarum null cannot be matched, and a PASS is unattainable with the kept set. The runner then refuses confirmation, and the seed log holds no confirm entry.

## The numbers

Plan `full` (timing gate 2,582 aggregate steps per second): 5 arms (inherit, blocked, pc-light, pc-upkeep, pc-blind) x slots 2001-2020, 100,000 steps each, window W = steps (50,000, 100,000]. 100 runs, 10.0M GPU steps, about 53 minutes wall at `--jobs 8`. The 20 physarum dev runs were not run, because there was no deposit rate to run them at.

**Deposit target (6.3).** Median inherit deposit rate `d` is 1.987e-6, far under 1/16. The trail-on fallback needs 4 trail-on seeds and has 0. So `T` is none, `v` is none, matching (6.5) is "limited", and no physarum run exists.

**Regime classifier (6.4).** Otsu cut -0.9728 on log10(TM + 0.01), tau 0.0965. Classes: 17 low, 3 high (seeds 2010, 2012, 2020). Between-class share 0.778, gap 0.565 against within-class SD 0.389. The high class has 3 seeds against the 4 required, so the classifier is not adequate and REG is dropped.

**Moran's I (MI, 6.7).** Measurable (all 100 heavy censuses in W valid) in 1 of 20 inherit seeds (2012); 8 are needed. MI is dropped. Median invalid-census fraction 1.00.

**Keep rule.** One Holm over the 12 control-readout tests (3 controls x TM, AGE, TURN, SIG), alpha 0.05, |delta| at least 0.33:

| control | readout | adjusted p | delta | |
|---|---|---|---|---|
| pc-upkeep | AGE | 0.0013 | -0.680 | separates |
| pc-upkeep | TURN | 0.0002 | +0.755 | separates |
| pc-upkeep | TM | 0.224 (raw 0.0224) | +0.420 | not significant |
| pc-light | TM | 0.869 | -0.295 | no |
| pc-light | AGE | 0.869 | +0.310 | no |
| pc-blind | every readout | 1.0 (TM 1.0) | -0.095 (TM) | no |
| every control | SIG | 1.0 | small | no |

Kept readouts: **AGE and TURN**. A PASS needs TM or REG, plus MI (section 8), so it is unattainable and confirmation could only have returned NOT-SEPARATED or PHYSARUM-EXPLAINS.

**What the dev seeds looked like (inherit, W).** Per-seed TM ranges from 0 to 1.445. 13 of 20 seeds have TM under 0.01 and 6 have exactly zero trail in the window. Only seed 2012 is clearly trail-on (TM 1.445, sum P 6,568, `d` 0.0145); 2003, 2010, 2011, 2014, 2016 and 2020 are intermediate. Blocked holds 1.8-2.4 units of trail per particle in all 20 seeds.

**Integrity.**

- Ledger: all 100 runs have 1,000 ledger checks at residual 0.
- Population guard: no trips in any arm. Lowest n in W: inherit 4,177 (seed 2007), blocked 4,636, pc-light 6,003, pc-upkeep 2,923, pc-blind 4,145. No run touched the cap.
- Provenance: Freeze 1 hashes verified for `dev` and `confirm` with no problems; protocol SHA-256 and code hash (`707efb91...6517`) match the disk; Freeze 2 (`calibration_sha256` `002c264f...cc2563`) equals the SHA-256 of `CALIBRATION.json`.
- Seed log: 202 entries (100 dev runs and one cpu-check, each started then finished), a single plan, no `invalid`, no confirm slot. All 100 run-file hashes and digests equal the finished entries.
- CPU cross-check: inherit slot 2001, CPU digest equals GPU digest `9c5f3913b295d045` under the frozen code hash. There is no physarum or confirmation cross-check because those runs do not exist.

## What this shows

- In this world, over steps 50,000-100,000, the inherit arm mostly loses its trail. By step 50,000 most seeds hold none or a little. That left the matched physarum null with nothing to be matched to and the structure readout (MI) with almost no measurable seeds, so the frozen design could not reach a confirmation that could pass.
- Two readouts, AGE and TURN, respond to a gross physical change (upkeep x1.5) and are therefore usable instruments. They are life-history readouts, and the protocol already says they separate inherit from the null by construction.
- Descriptive contrasts of inherit against blocked, informational and read by no rule: TM delta -1.00 (every blocked seed has more trail per particle than every inherit seed; exact p 1.5e-11, the report's 1.0e-6 is the permutation floor under ties), AGE delta -1.00 (blocked median age about 60,000 against 200-4,600), TURN delta +0.605, SIG delta -0.215 (p 0.25, not significant).

## What this does not show

- It does not say that heredity matters, or that it does not. It says nothing about heredity's effect on trail where trail exists: blocked has trail everywhere, inherit mostly does not, and that difference is the largest seen, but the protocol cannot use it. Blocked is a different population (new random controllers at every birth), not simply "inherit minus heredity".
- It says nothing about adaptation, individuality or open-ended evolution, and nothing about a steady state or horizons beyond 100,000 steps.
- The blocked contrast is dev data. Nothing from confirmation slots exists.

## Skeptic findings that sharpen the reading

The skeptic's refutation attempts left the label unchanged and changed how it should be explained:

- **The 1/16 floor is above every observed deposit rate, not only inherit's.** The largest `d` of any run in any arm is 0.033 and blocked (trail in all 20 seeds) sits at 0.018-0.024; a `d` of 1/16 would need TM near 6.25 while the largest window TM is 3.32. So 6.3 would have bound even if inherit had kept its trail. "Nothing to match because inherit lost its trail" is true but incomplete: the 1/16 floor together with the 1% per step trail decay is part of the cause. `CALIBRATION.md` (written by the runner) gives only the first explanation; this paragraph supersedes it.
- **Population size does not explain the contrast.** Inherit seeds with n close to blocked's still have TM at most 1.445, below blocked's minimum 1.761. Within inherit, TM does not follow n (rho 0.05).
- **The classifier verdict is fragile, the label is not.** The 17/3 split fails the 4-per-class rule by one seed and depends on the log floor (floors 0.001 and 0.0001 give 13/7, adequate). If it were adequate, the fallback `T` would still be under 0.003, so 6.3 still fails, and MI could be measurable in at most 7 seeds at any cutoff tried, short of 8. A per-control Holm (instead of one over 12) would keep TM, but MI would still be missing.
- **A longer horizon would likely make this worse.** Seeds with TM at least 0.1: 8 in (10k, 50k], 5 in (25k, 75k], 3 in (50k, 100k]. Of the six seeds that ever reach TM 0.1, all but 2012 decline through the window. Blocked is not stationary either (TM falls from 2.45 to 2.29 over the last 10k).
- **No seed leakage, no multiple-comparison slip, no census-cadence problem** (details in the skeptic's record; the only same-slot cross-arm correlation above 0.5 is pc-light with pc-upkeep, one pair of about 30).

## Limits of the checks

- Per-census Moran, SIG, median age, `d` and ledger residual come from the stored series, not from raw fields or genomes, which are not stored. The skeptic checked `d` against decay times TM, `moranInvalid` against sum P, and the Moran formula by algebra. It did not recompute SIG, median age or the Moran values themselves, and did not reproduce the bootstrap intervals.
- Physarum matching quality is untestable here: no physarum or matching run exists.
- Drift past 100,000 steps is extrapolation from the (50k, 100k] window.
- The analyst re-ran the frozen analysis code and the skeptic reimplemented it independently; neither can see a flaw in the protocol's design choices, only in its execution.

## Amendments and deviations

- **Amendments: none.** `PROTOCOL.md` is unedited since Freeze 1. This is within the cap of two amendments before a first confirmation run, so the cap is unspent.
- **Deviations: none.** Runs were executed as frozen; the runner verified Freeze 1 before the first logged run and Freeze 2 was applied before any attempt at confirmation, which the runner then refused.
- **Record defects (cosmetic, do not affect the label):** `matching.json` records `T` as 0 where `CALIBRATION.json` has null, and the 6.3 reason line appears twice in `CALIBRATION.json` and `calibration-report.txt`. Both are runner outputs and are left as written.
- **No `ANALYSIS.md`.** The analyst's attempt to write one was refused by the harness and not worked around; its content is the numbers and integrity sections above.
- **Dependencies on uncommitted code.** Freeze 1 was taken on the uncommitted working tree on top of c0966c4c, so the frozen hashes describe files, not a commit. Committing exactly this tree preserves the freeze; any later edit to a file listed in `FROZEN` invalidates it. `r2b-analyze.ts calibrate --dry-run` and `confirm --dry-run` were run again after the page and `STATUS.md` edits of this write-up and still report matching Freeze 1 hashes (neither the page nor `STATUS.md` is in `FROZEN`).

## Comparison with R2

| | R2 | R2b |
|---|---|---|
| Engine | CPU | GPU (CPU cross-check of one run) |
| Horizon, window | 20,000 steps, (10k, 20k] | 100,000 steps, (50k, 100k] |
| Seeds per arm | 5 | 20 |
| Arms | inherit, blocked, frozen, physarum, 2 controls | inherit, blocked, 3 controls (physarum null planned, not run) |
| Why limited | 2-SD noise floor set by inherit's seed-to-seed spread exceeded every effect; no readout kept | the null cannot be matched (inherit's trail gone, and the 1/16 floor above every `d`); MI unmeasurable; a PASS unattainable |
| Readouts kept | none | AGE, TURN (both separated by pc-upkeep) |
| Confirmation | not run | not run |
| Label | MEASUREMENT-LIMITED | MEASUREMENT-LIMITED |

What carried over: inherit is strongly seed dependent, its trail decays rather than settling, and the blocked arm differs from it in the same direction in both rungs (inherit has much less trail and much lower mean age). What R2b added: with 20 seeds the seed dependence is a spread of regimes (mostly no trail, a few intermediate, one clear trail-on seed), the controls now do separate two life-history readouts, and the trail-on state, which R2 saw in one seed at 20,000 steps, mostly disappears by 50,000. What R2b did not do: either rung's confirmation, or any test of heredity against a matched trail-following null.

## What would restart it

Only a dated `## Amendment` (at most two before a first confirmation run, each with a reason that does not cite a dev result) or a new protocol, R2c. The protocol cannot be loosened to rescue this label. Questions a new design would have to settle without looking at confirmation seeds: whether the deposit-matching floor of 1/16 is the right scale for a world whose blocked arm deposits at 0.02; whether a window earlier than 50,000 steps, where trail still exists, answers the question the protocol asks; and whether the structure readout needs a trail-mass-free definition. These are open questions, not a decision.

## Final review (Codex Sol 6.1 High, read-only, 13 Nov 2026)

It checked all 38 `FROZEN` file hashes, the code hash, the protocol hash and the calibration hash (all match), found no diff in `packages/*` and no new key in `defaultConfig()`, matched all 100 dev run files to their logged hashes and digests, and found the numbers in this file, `STATUS.md` and the page copy consistent with the data and free of any claim about heredity either way. Its checks were static (no GPU or browser run). Findings:

1. **P1, `r2b-decide.ts` line 543, frozen, OPEN: trail mass can still pick which seeds enter the structure (MI) comparison.** Requiring every census of a run to be valid stops mass selecting censuses inside a run, but each arm's MI values are filtered separately, so mass still selects which seeds are compared. Sol built a synthetic case (every arm the same two spatial patterns; inherit's fields halved so its sparse seeds fall under the 500-unit cutoff) in which `decide()` returned PASS with both Holm-adjusted p-values 0.0349 although the normalised spatial patterns were identical. This weakens the claim that PASS needs an independent STRUCT factor. It does not touch this result: no confirmation ran, and the label comes from 6.3 and 6.7 at calibration. The file is covered by the freeze, so any fix needs a dated amendment (and a new Freeze 1 and dev re-run), and that amendment's reason must not cite a dev result. An R2c or an amendment should address it before any confirmation run is allowed to return PASS. Not repaired here.
2. **P3, `page.ts` brush preview, fixed:** the preview drew one circle while the brush measures distance around the torus, so a stroke near an edge hid its effect on the opposite edge. The preview now draws wrapped copies.

No other P1 or P2.

## Verification run for this write-up

Command results (typecheck, full suite, GPU parity, Playwright) are in the session's final report. The Sol text is in the session scratchpad (`r2b-final-sol.txt`).

## Reproducing this result (note added 14 Nov 2026, when the line landed on main)

`FROZEN` covers `tools/mycelium/world.ts`, `gpu.ts` and `RULES.md`. The later trail-conduit commit (`3e4a51a1`) changed all three, so at the tip of the branch, and on main, the freeze check refuses to run. Check out commit `edc25af9` to re-run or re-analyse: every file `FROZEN` covers matches its recorded hash there (checked 14 Nov 2026). The recorded hashes are unchanged, and nothing in this result was re-derived.
