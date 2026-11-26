# Mycelium R2: calibration record (dev seeds 101-105)

Run 2026-11-13 under Freeze 1 (`FROZEN`: protocol_sha256 29652a2c..., code_hash 8055819d...; both re-verified unchanged after the runs). Protocol section 6 executed as written; no amendment, no frozen file changed, no fresh seed (9001+) touched.

## Outcome: calibration verdict MEASUREMENT-LIMITED, confirmation NOT run

`r2-analyze.ts calibrate` kept no readout (`|S| = 0 < 2`). Protocol section 6.6: "If |S| < 2, the verdict is MEASUREMENT-LIMITED and confirmation is not run." So no confirmation run was started, `calibration_sha256` was not appended to `FROZEN` (Freeze 2 never happened), and `runs/mycelium-r2/confirm/` does not exist. The seed log holds 35 `finished` entries (5 pass1, 30 dev), no `invalid` entry, no fresh-seed entry.

Population guard (section 7): no trip on inherit, blocked, physarum, or either positive control. No run touched the cap (`refused` 0 in W everywhere). Ledger: every run checked matter and energy after each of its 20,000 steps, residual 0 (35 runs).

## Numbers

theta = 4 (nearest-rank 75th percentile of P over P>0 cells, pass-1 histogram; `evidence/dev-pass1/theta.json`). Pass-2 inherit digests equal pass-1 digests on all five seeds (62731b9bb673a39f, 89c50595acc632cc, fae564a0a1bdbf9c, ef6fa44aff61a3b7, 1d2456048920ed0f), so the run is reproducible.

Noise floors (NF = 2 x larger SD of the two arms; identical for both contrasts here because inherit dominates the SD):

| readout | SD inherit | SD blocked | SD physarum | NF_B | NF_P | dropped |
|---|---|---|---|---|---|---|
| R1 | 0.2920 | 0.0004 | 0.0000 | 0.5839 | 0.5839 | no |
| R2 | 0.1824 | 0.0028 | 0.0654 | 0.3647 | 0.3647 | no |
| R3 | 0.0917 | 0.0686 | 0.0321 | 0.1834 | 0.1834 | no |
| R4 | 1.0148 | 0.0172 | 0.0220 | 2.0296 | 2.0296 | no |

Positive controls (paired control - inherit, against NF_B): no readout was sensitive to either control. Mean differences against floor: pc-light R1 -0.132 (NF 0.584), R2 +0.021 (0.365), R3 -0.015 (0.183), R4 +0.530 (2.030); pc-decay R1 -0.122, R2 -0.051, R3 -0.026, R4 +0.171. Supporting seeds were at most 3/5 and the mean was never above the floor. Both controls were usable (no guard trip).

Dev contrasts (informational): inherit vs blocked separates on no readout (R2 reaches 3/5 supporting seeds but |D| 0.22 < NF 0.36). Inherit vs physarum separates on R2 only (D -4.64, 5/5). Section 2 predicted separation on R1, R2 and probably R4; R1 and R4 did not separate because of inherit's spread.

## Why it came out this way (observation, not a repair)

The inherit arm is strongly seed-dependent in the measurement window. Per-seed inherit values: R1 = 0.654, 0.004, 0.001, 0.000, 0.000 (one seed holds a connected trail, four have a thin trail with sum P of 60 to 1,650 against 35,850 on seed 101); R4 = 2.78, 0.89, 0.77, 2.10, 0.37; mean particle age 555 to 2,916. Blocked is almost deterministic across seeds (R2 1.000-1.006, R4 0.99-1.03, n about 4,880, sum P about 13,900). Because the floor is 2 x the larger SD, inherit's seed-to-seed spread alone sets a floor that the blocked difference and the two physical controls do not clear (the physarum difference clears it on R2 only, by construction). pc-light does not move a mean beyond that spread (n about 6,500, trail near zero in every seed), and pc-decay tracks inherit seed by seed (R4 2.80/1.84/0.77/1.98/0.39 against 2.78/0.89/0.77/2.10/0.37). The R1 degeneracy drop did not fire because inherit's R1 mean (0.13) is above 0.05.

This is a statement about this world at this horizon with five seeds and a 2-SD bar. It is not evidence that heredity does or does not matter (protocol section 12), and nothing here reads any fresh seed.

## What would restart the protocol

Only a dated `## Amendment` in `PROTOCOL.md` (new freeze, re-run pass 1 and dev, Freeze 2), or a new protocol R2b. Candidates a human could weigh before choosing (none was applied): more dev seeds to measure inherit's mode structure, a floor defined on a robust spread or on within-mode variance, a longer horizon, or a readout set that captures inherit's bimodal trail regime. Any of these is a decision for the owner of the protocol, made without looking at seeds 9001-9005.

## Task items not done

- Confirmation on seeds 9001-9005: not run, stopped by section 6.6.
- GPU path and CPU/GPU digest spot-check: not applicable. Section 3 mandates CPU for all R2 arms, `r2.ts` has no GPU path, and no confirmation run exists. The pass-1 vs pass-2 digest match is CPU determinism only.

## Files

- `runs/mycelium-r2/dev-pass1/`, `runs/mycelium-r2/dev/` (gitignored; `report.md`, `series.json` per run, `logs/`): wall time about 12 minutes for 35 runs (5 concurrent CPU runs, 10 cores, other sessions running; about 90 s per pass-1 run).
- `docs/mycelium-r2-2026-11-13/CALIBRATION.json` (written by the tool), `seed-log.jsonl` (35 finished entries), `evidence/` (all 35 series.json, each under 75 KB, `dev-report.md`, `dev-pass1/theta.json`).
