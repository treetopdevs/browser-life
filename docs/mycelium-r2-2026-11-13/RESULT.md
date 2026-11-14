# Mycelium world: rungs R1 and R2, result (13 Nov 2026)

**R1 (GPU port): parity holds on every case tried.**
**R2 (does heredity matter?): MEASUREMENT-LIMITED.** The instrument could not tell, at this horizon with five dev seeds, whether heredity matters. Confirmation was not run. This is not a FAIL and not evidence about heredity in either direction.

Everything here is uncommitted, local, CPU (R2) and native WebGPU on this Mac (R1). Nothing is deployed and the `/mycelium/` page stays `noindex` and 404 on the public site.

## R2: the label

Two independent analyses were made after the runs finished. Both give **MEASUREMENT-LIMITED**, with the same kept set (empty) and the same numbers. They do not disagree, so there is no more conservative label to choose.

- Analyst: re-ran `tools/mycelium/r2-analyze.ts calibrate` on scratch copies (its own FROZEN checks passed); the regenerated `CALIBRATION.json` and dev report are byte-identical to the ones on disk; a separate Python recomputation of every floor, control effect and contrast matches.
- Skeptic: recomputed all 120 readout values (4 readouts x 6 arms x 5 seeds) straight from the raw `series.json` files without using `r2-analyze.ts`, 0 mismatches, and ran exploratory refutation checks (population size, census cadence, construction differences, seed leakage). None changes the label.

Rule applied (PROTOCOL sections 6.6 and 8): the kept set `S` is empty, `|S| = 0 < 2`, so confirmation is not run and no PASS, FAIL, PARTIAL or NOT-SEPARATED verdict exists.

## R2: the numbers

Dev seeds 101-105, 20,000 steps, window W = steps 10,000-20,000, `theta` = 4. Freeze 1 only; Freeze 2 never happened.

Noise floors (NF = 2 x the larger SD; identical for the blocked and physarum contrasts because inherit dominates):

| readout | SD inherit | SD blocked | SD physarum | NF |
|---|---|---|---|---|
| R1 trail connectivity | 0.2920 | 0.0004 | 0.0000 | 0.5839 |
| R2 patchiness | 0.1824 | 0.0028 | 0.0654 | 0.3647 |
| R3 oscillation | 0.0917 | 0.0686 | 0.0321 | 0.1834 |
| R4 turnover | 1.0148 | 0.0172 | 0.0220 | 2.0296 |

No readout was dropped (inherit R1 mean 0.132, above the 0.05 degeneracy bar).

Arm means over the five seeds (inherit / blocked / frozen / physarum): R1 0.132 / 0.001 / 0.115 / 0.000; R2 1.223 / 1.003 / 1.144 / 5.865; R3 0.099 / 0.117 / 0.037 / 0.157; R4 1.383 / 1.012 / 1.257 / 1.301.

Positive controls (inherit with one physical change; mean paired difference, against NF; supporting seeds out of 5). A readout is kept only if it separates under at least one control. None did:

| | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| pc-light (light 2) | -0.132 (1/5) | +0.021 (1/5) | -0.015 (2/5) | +0.530 (3/5) |
| pc-decay (pDecay x4) | -0.122 (1/5) | -0.051 (1/5) | -0.026 (1/5) | +0.171 (0/5) |
| NF | 0.584 | 0.365 | 0.183 | 2.030 |

Both controls were usable (no population-guard trip). No mean difference reached its floor.

Dev contrasts (informational, nothing reads them): inherit minus blocked separates on no readout (R1 +0.131 with 1/5 seeds, R2 +0.220 with 3/5 but below NF 0.365, R3 -0.018, R4 +0.371). Inherit minus physarum separates on R2 only (-4.642, 5/5 seeds). The physarum separation is expected by construction: that arm deposits one unit every step, so it holds about 220k units of trail and 2.2k particles against 4.7-5.7k for inherit.

Why the floors are so wide: inherit is strongly seed dependent. Per-seed inherit R1 is 0.654, 0.004, 0.001, 0.000, 0.000 and R4 is 2.78, 0.89, 0.77, 2.10, 0.37. Blocked is almost the same on every seed (R2 0.999-1.006, R4 0.99-1.03). Inherit's spread alone sets every floor. That floor is larger than every control effect and every inherit-minus-blocked difference. The one contrast that did clear a floor is inherit-minus-physarum on R2 (|D| 4.64 against NF 0.36, 5/5 seeds), and that is the by-construction difference noted above, not evidence about heredity.

Integrity checks:

- **Ledger:** all 35 runs (5 pass 1, 30 dev) checked matter and energy after every one of 20,000 steps; residual 0 in all.
- **Provenance:** every run file carries code hash 8055819d..., equal to `FROZEN`; protocol SHA-256 equals `FROZEN`; no amendment was made.
- **Population guard:** no trip on any arm or control. Lowest n in W: inherit 4,478, blocked 4,800, physarum 2,177, frozen 3,937, pc-light 5,719, pc-decay 4,689 (threshold 200). No run refused a birth, so the cap was never touched.
- **Determinism:** pass-1 and pass-2 inherit digests match on all five seeds (CPU only).
- **Seed log:** 70 lines (35 started, 35 finished), no `invalid`, highest seed 105. No fresh seed (9001-9005) was run and `runs/mycelium-r2/confirm/` does not exist.

## What this shows and does not show

Shows:

- With five seeds and a 2-SD floor, the four frozen readouts cannot resolve the inherit-versus-blocked difference at 20,000 steps in this world, and they did not respond to a doubling of light or a fourfold faster trail decay either. The instrument as frozen is too noisy for this arm.
- The physarum null is very different from inherit on R2, trail mass and population, as the protocol said it would be.

Does not show:

- That heredity matters, or that it does not. Absence of separation is not evidence of absence (PROTOCOL section 12), and five seeds can only see large effects.
- Anything about a steady state. Inherit drifts across W (for example seed 101's R1 is 0.465 in the first half and 0.843 in the second), so the result is about steps 10,000-20,000.
- Anything about adaptation, individuality or open-ended evolution.

Post-hoc observations (exploratory, gate nothing, would need a dated amendment or a new protocol before any use): inherit sits above blocked on R2 on 4 of 5 seeds; inherit's trail mass is 10-200x lower than blocked on 4 of 5 seeds; mean particle age is 555-2,916 for inherit against about 8,300 for blocked. The blocked arm is a different kind of population (new random controllers each birth), not simply inherit minus heredity. R1 follows trail mass almost exactly within inherit (correlation 1.00), so it is effectively a threshold on trail mass against `theta` = 4; R4 correlates 0.84-0.86 with n. Removing seed 101 does not rescue inherit-minus-blocked (R2 +0.18 against NF 0.37, R4 +0.02 against NF 1.49).

Limits of the checks: the analysts recomputed the averaging, R3 and R4 statistics, `theta`, floors, effect test and verdict, but took the per-census R1 and R2 values as the observer wrote them (PROTOCOL section 9 says the same). The determinism evidence is CPU only.

## What would restart R2

Only a dated `## Amendment` in `PROTOCOL.md` (new Freeze 1, re-run pass 1 and dev, then Freeze 2) or a new protocol R2b. No repair was applied and no threshold was changed. Candidates for the owner of the protocol to weigh, all decided without looking at seeds 9001-9005: more dev seeds to measure inherit's seed-to-seed modes, a floor on a robust spread or on within-mode variance, a longer horizon, or readouts that capture inherit's two trail regimes.

## Amendments and deviations

- **Protocol amendments: none.** `PROTOCOL.md` and every file `code_hash` covers still match the hashes recorded in `FROZEN` (Freeze 1), checked again after this write-up's edits (`code_hash` 8055819d...). `CALIBRATION.json` was written after Freeze 1 and is not itself frozen (Freeze 2 never happened); it reproduces exactly from the stored runs by re-running `r2-analyze.ts calibrate`.
- **RULES.md not edited.** The task asked for status lines in `tools/mycelium/RULES.md` to be updated. `RULES.md` is inside `code_hash` (PROTOCOL section 10), so editing it would make `r2-analyze.ts` refuse the frozen calibration and break the provenance chain of the R2 result. Status therefore lives here, in `tools/mycelium/STATUS.md` (not covered by the hash) and on the page. RULES.md still says the inherit-versus-blocked comparison "belongs to rung R2"; read it together with this file. Its "Not in R0" list is still correct.
- **No `ANALYSIS.md`.** The analyst's attempt to write one was refused by the harness and was not worked around. Its content is the "numbers" and "integrity checks" sections above.
- The analyst's GPU spot-check is not applicable: R2 runs on the CPU only (PROTOCOL section 3), and the physarum arm is not ported to WGSL (`gpu.ts` throws on it).

## R1: GPU parity status

`tools/mycelium/gpu.ts` is the WGSL port of the whole rule set, with no floating point in the step. **Parity holds**: `deno run -A --no-lock tests/deno/mycelium_gpu.ts` prints "all 19 cases match bit for bit", comparing the state digest of the whole checkpoint encoding at every checkpoint. The R1 verification run and a re-run for this write-up (13 Nov 2026; it overlapped the editing of this file and the page, and `gpu.ts` was unchanged and equal to its `FROZEN` hash throughout) both printed "all 19 cases match bit for bit".

Configs covered by that script:

- the three heredity arms (inherit, frozen, blocked) and both light patterns (uniform, gradient);
- a 256 x 256 world, and a 512 x 512 world at the 65,536-particle cap with refusals;
- resume: readback, `encode`, `decode`, upload, continue, with both ping-pong sides tested after the object had stepped past the checkpoint;
- a step whose `lightIn` (2.7e11) and `heat` (2.3e10) each pass 2^32, and a workgroup whose heat sum is exactly 2^32;
- particle-id and genotype-id exhaustion (the cut falls inside a step, in every heredity arm);
- hot cells with 65,536 requesters (the `r * A` bound) and 3,000 requesters with births;
- steps across 2^32, and the 2^50 ledger bound (landing on it and passing it).

The verification also ran 23 extra probes (scratch scripts, not committed) against the CPU, with equal `stateDigest` and clean `validateState` at every 50-step checkpoint: seeds 7, 12345 (gradient), 3, 4 and others; `mutRate` 65536 with `mutCount` 0 and 16; caps of 300 (108k refusals) and 1; extreme shifts and decays; tiny and non-square worlds (8 x 8, 37 x 91 blocked); `founders` 0; ids and genotype ids near the limit at tight caps; 20,000 particles on an 8 x 8 gradient world. A line-by-line read of `gpu.ts` against `world.ts` found no float arithmetic and no divergence.

Not covered by parity: the physarum arm (CPU only by design) and any config other than `defaultConfig()`-style worlds in the cases above.

### R1 review findings (Codex Sol 6.1 High, read-only; static, native GPU was unavailable in its sandbox)

The `gpu.ts` and `RULES.md` parts are frozen files (inside `code_hash`) and are left open on purpose. The one non-frozen item, the assertion at `tests/deno/mycelium_gpu.ts:365`, is also left open (see finding 2). Findings 1 and 2 cannot occur in a real run. Finding 3 is a caller-ordering hazard: it cannot happen while the caller awaits `read()` before calling `upload()`, as every current caller does, but nothing in the code enforces that.

1. P2, `gpu.ts` line 544: cumulative non-ledger counters (births, deaths, refused, contended, mutations) are exact integer pairs on the GPU but JS doubles on the CPU, so they round differently past 2^53 (a state with `totals.contended` = 2^53 diverges after two contended steps). `validateState` does not bound these counters. Reaching 2^53 would take about 10^9 years.
2. P2, `gpu.ts` line 543: at step exactly 2^53 the CPU continues (the increment rounds back) while the GPU sets an error bit and `read()` throws; `upload()` rejects step above 2^53. The documented restriction ("CPU throws or is inexact") is slightly wrong at exactly 2^53, and `tests/deno/mycelium_gpu.ts:365` asserts the GPU-only behaviour. A wording fix in `RULES.md` (frozen). The assertion at `tests/deno/mycelium_gpu.ts:365` is in a file `code_hash` does not cover; it checks GPU-only behaviour with no CPU comparison, and was left as is because the behaviour it asserts is the documented one.
3. P3, `gpu.ts` line 708: `read()` reads `this.matter0` and `this.energy0` after awaiting; a concurrent `upload()` replaces them while the GPU copies were queued earlier, so overlapping read and upload would return a mismatched ledger anchor. The harness always awaits `read()` before `upload()`. Fix: capture the anchors at the top of `read()`, or document that they must not overlap.

Fixing any of them changes `gpu.ts` or `RULES.md`, which are covered by the R2 code hash, so the fix needs a dated amendment and a re-run of pass 1 and dev, or a deliberate decision that R2's CPU results do not depend on `gpu.ts` (they do not run it, but the hash does cover it).

### Final review of the whole worktree (Codex Sol 6.1 High, read-only, 13 Nov 2026)

It found no divergence in the frozen hashes or evidence calculations, no change to the research kernel and no leak of the private page in the deployment path, and it supports the MEASUREMENT-LIMITED label. Its checks were static (typecheck and an in-memory production build passed; vitest and GPU parity were not run in its sandbox). Four findings:

1. P2, `gpu.ts` line 710, frozen: the read/upload overlap hazard (R1 finding 3 above). Open. This write-up had said none of the findings could occur in a real run; reworded.
2. P2, `RESULT.md`: said `CALIBRATION.json` was byte-identical to Freeze 1, which has no such baseline. Fixed above.
3. P3, `observe.ts` line 34, frozen: `smokeWindow()` accepts step counts that are multiples of 100 but halves them for burn-in, which must be a multiple of 100, so `--phase smoke --steps 500` (also 700, 900, ...) fails with `invalid R2 window`. Smoke runs only; no R2 result is affected. Open (editing `observe.ts` would break the freeze).
4. P3, `RESULT.md` and `CALIBRATION.md`: said every floor exceeds every observed contrast, which is false for inherit-minus-physarum on R2. Fixed in both.
