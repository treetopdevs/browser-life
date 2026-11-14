# R2b calibration (2026-11-13): MEASUREMENT-LIMITED, no confirmation run

Executed exactly as frozen (`PROTOCOL.md`, Freeze 1 hashes verified by the runner before the first run: `verifyFrozen("dev")` returned no problems). Plan `full` (20 dev slots, 2001-2020). No amendment, no deviation. Machine-readable record: `CALIBRATION.json` (its SHA-256 is the `calibration_sha256` line of `FROZEN`, Freeze 2). Full tables: `calibration-report.txt`. Small evidence copies: `evidence/`. Seed log: `seed-log.jsonl`.

## Verdict

**MEASUREMENT-LIMITED** at calibration, by the protocol's own rules. Confirmation (slots 5001-5016) was not run, and the runner refuses it: "the calibration verdict is MEASUREMENT-LIMITED; confirmation is not run". The seed log holds no confirm entry. This is the outcome section 1 predicted before any dev run.

Reasons printed by `calibrate`:

1. **The physarum null cannot be matched (6.3).** Median dev inherit `d` is 1.99e-6, far under 1/16. The trail-on fallback is unavailable: the regime classifier (6.4) is not adequate, so it supplies no trail-on seeds (0 of the 4 needed). `T` is null, matching (6.5) recorded `limited`, no physarum `v`, and the 20 physarum dev runs were therefore not run (nothing to run them at).
2. **A PASS is unattainable with the kept set (6.7).** Kept readouts: AGE and TURN (both separated by pc-upkeep only). A PASS needs TM or REG, and MI.

## What the 20 dev seeds showed (inherit, W = (50k, 100k])

- **Trail mostly absent.** Per-seed TM (trail mass per particle) ranged from 0 to 1.445; 13 of 20 seeds had TM under 0.01 and 6 had exactly zero sum P in the window. Only seed 2012 (TM 1.445, sum P 6,568, `d` 0.0145) is a clear trail-on seed; seeds 2003, 2010, 2011, 2014, 2016 and 2020 are intermediate (TM 0.02-0.26, sum P 100-1,400).
- **Regime classifier (6.4):** Otsu cut at log10(TM + 0.01) = -0.973 (tau 0.0965), classes 17 low / 3 high, between-class share 0.778, gap 0.565 against within-class SD 0.389. The high class has 3 seeds, under the 4 required: NOT adequate, REG dropped.
- **Moran's I (MI):** measurable (all 100 heavy censuses valid) in 1 of 20 inherit seeds (seed 2012); needs 8. MI dropped. Median invalid-census fraction 1.00.
- **TM was not kept as a readout** (no control separated it: pc-upkeep p 0.022, adjusted 0.224, delta 0.42, not significant after the one Holm over the 12 tested control-readout pairs (3 controls x TM, AGE, TURN, SIG); pc-light delta -0.30; pc-blind not at all).
- **Controls:** all three usable (no population-guard trip, none of the five arms tripped; `guardTrips` empty). pc-upkeep separated AGE (delta -0.68, adjusted p 0.0013) and TURN (delta 0.755, adjusted p 0.0002). pc-light and pc-blind separated nothing. SIG separated by none.
- **Blocked** (informational, 6.9): TM p 1.0e-6, delta -1.00 (blocked carries 1.8-2.4 units of trail per particle in every seed, with a measurable MI of 0.21-0.23 in all 20; inherit mostly none); AGE delta -1.00 (blocked median age about 60,000, inherit 200-4,600); TURN delta 0.605. Blocked has trail in all 20 seeds; inherit does not. SIG delta -0.215, not significant. These are descriptions of dev data only; nothing reads them.
- **Horizon diagnostic (6.8):** first-half versus second-half Spearman across inherit seeds: TM 0.91, AGE 0.98, TURN 0.96, SIG 0.98 (MI and REG not defined). Per-seed half-window values and drift tables are in the report; inherit TM drift between halves is large in trail-on or marginal seeds (relative drift between -2 and +2), blocked's is about -0.05.
- **Ledger:** all 100 dev runs reported 1,000 ledger checks at residual 0.
- **No population-guard trips** in any arm (inherit min n over the window 4,177; all 100 runs "guard ok"; no control touched the cap).

## CPU cross-check (section 10)

Dev inherit slot 2001, 100,000 steps on `world.ts`: CPU digest equals GPU digest `9c5f3913b295d045` (`evidence/cpu-check.json`, code hash `707efb91...`). The dev physarum cross-check was not run: there are no physarum dev runs when the null cannot be matched (`calibrate` requires it only when `v` is non-null). No confirmation run exists, so no confirmation cross-check.

## Freeze 2

Appended to `FROZEN` (one line, after calibration, before any confirmation run): `calibration_sha256: 002c264fd4d7dc8facfadff0c67f20cd3f8677b3291a282b0bd7144b7e35cc8a`. It binds the calibration outputs: kept readouts (AGE, TURN), regime threshold (none: REG dropped; the rejected classifier's cut and tau are recorded for the report only), physarum parameter (none: `v` null), and the SHA-256 of every dev `series.json`. After this line `calibrate` refuses to rewrite `CALIBRATION.json`, and `verifyFrozen("confirm")` passes on hashes but the runner still refuses confirmation on the verdict.

## Compute

100 dev runs (5 arms x 20 slots x 100,000 steps = 10.0M GPU steps), `--jobs 8` on one GPU, 20:14:53Z to 21:07:18Z (about 53 min wall, about 3,100 aggregate steps per second, above the timing gate's 2,582). Matching and physarum dev: not run (limited). One 100k-step CPU run (7.4 min wall, beside the batch).

## What this does and does not say

A result about this window, these rules and these 20 worlds: with inherit's trail gone or intermittent by step 50,000, the matched-null design has nothing to match and the structure readout has no measurable seeds. It says nothing about heredity's effect on trail where trail exists (blocked has trail everywhere; inherit loses it in most seeds, which is itself the largest dev-seed difference, delta -1.00 on TM). Per section 10, only two amendments are allowed before a confirmation run, each with a reason that does not cite a dev result; whether to amend or write R2c is not decided here.
