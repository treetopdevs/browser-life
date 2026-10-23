# 3D rung 1a benchmark: 2026-10-22

Question (docs/3d-brainstorm-2026-10-22.md, sections 3 and 5): does a 3D affinity pass at 64^3 (R=4, 250 taps, or R=3, 92 taps) or the slab 256x256x8 stay within the predicted ratio of today's 2D affinity pass (256x256, R=9, 224 taps)? Bars: 64^3 R=4 at most 4.5x, otherwise R=3 at 1.6x, or the slab at 3.3x (R=3) / 8.9x (R=4); if none, the verdict is stop.
Code and raw data: `experiments/3d-bench/` (throwaway; no physics, shader, schema or golden file touched; nothing committed). `experiments/3d-bench/results.md` carries the same tables.

Device: Apple M1 Max, Metal, a heavily loaded machine (load average about 500 from other sessions during the Chrome runs). `timestamp-query` in both stacks; limits raised to the adapter's (1024 invocations, 32 KiB workgroup storage) so the literal 8x8x8 workgroup can be tried.
Stacks: Deno 2.9.7 native WebGPU (wgpu/naga) and Chrome 155 (Dawn/Tint, `--enable-webgpu-developer-features` so timestamps are unquantised), same machine, same harness and shaders.
Raw data: `data/deno-m1max.json` (+`deno-run2.log`; run 1 in `-run1`), `data/chrome-m1max.json` (run 2), `-run1`, `-run3`, `chrome-m1max-nobounds-diagnostic.json` (run 4, robustness off). Commands: `deno run -A --no-lock experiments/3d-bench/bench.ts --ablations --sweep --json=...` and `BL_BENCH_PORT=<free port> node experiments/3d-bench/web/run.mjs`.

## Verdict (plain words)

Under the plan's rule (Deno is authoritative, the browser is reported next to it), the rung 1a check is **STOP**: on the M1 Max no variant meets its predicted ratio in Deno/wgpu. (On the idle M3 Pro, last section, the primary geometry also stops but the plan's ablation 3 shape at R=3 passes at 1.09x.) 64^3 R=4 fails by about 4x or more (19.2x measured against the 4.5x bar; the best shape reaches 18.3-19.4x, the spread being two runs against their own T2 of 81.5 and 87.5 us). R=3 fails (3.66x specified, 2.04x best shape, against 1.6x). The slab fails (R=3 7.4x against 3.3x, R=4 34.8x against 8.9x).

Chrome is **not an unconditional pass either**. R=4 at 64^3 fails on every default run (8.4-11.1x specified, 5.6-7.4x best shape (run 3: 7.36x)). The specified R=3 passes in two of three default runs (1.42x, 1.45x) and fails in the third (1.76x), the specified R=3 slab likewise (2.6x, 2.7x pass; 3.48x fails against 3.3x). The flip comes from the denominator: today's 2D affinity pass took 274, 272 and 203 us in the three Chrome runs (53.9 vs 72.2 Gtap/s) while the 3D R=3 pass stayed at 358-396 us. So the Chrome pass is a property of a slow, unstable Chrome 2D baseline, not of a fast 3D kernel. The same unmodified 2D shader takes 80-87 us in Deno (about 170-184 Gtap/s). The honest summary is: "Chrome-only, run-dependent pass for the specified R=3; Deno STOP; the lead must re-rule which stack counts." Re-ruling to Chrome would also mean accepting a pass that flips with 2D baseline noise.

Absolute numbers are the safer reading: a 64^3 R=3 affinity pass costs 358-542 us as specified (Chrome, default settings) and 132-221 us with a tuned workgroup shape (Chrome), 166 us tuned in Deno; that is 262,144 cells for roughly 1-2.5 of today's 2D passes of 65,536 cells. R=4 costs 1.5-3.1 ms in Chrome and 1.6 ms in Deno at best. R=4 on 64^3 is out on every stack with default settings.

## Ratios against the bars

T2 = today's 2D affinity pass (256x256, R=9, 224 taps). Deno T2 = real GpuSim pass 87.5 us (isolated copy 80.2 us). Chrome T2 = isolated `affinityShader`: 274.1 (run 1), 272.5 (run 2), 203.2 us (run 3).

| check | bar | Deno (wgpu) | Chrome run 1 / 2 / 3 | 
|---|---|---|---|
| 64^3 R=4, specified (one `var<workgroup>`, 4x4x4 wg, block 2) | 4.5 | 101.8 (cliff artifact) | 9.45 / 8.39 / 11.05 FAIL |
| 64^3 R=4, split tile | 4.5 | 19.2 FAIL | 11.24 / 9.63 / n/a FAIL |
| 64^3 R=4, best shape | 4.5 | 18.3-19.4 (4x4x4 b1) FAIL | 6.2 (8x4x4 b1) / 5.6 / 7.4 FAIL |
| 64^3 R=3, specified | 1.6 | 51.9 (cliff artifact) | 1.42 PASS / 1.45 PASS (fails by wall clock: 1.63) / 1.76 FAIL |
| 64^3 R=3, split tile | 1.6 | 3.66 FAIL | 1.93 / 1.99 / 2.41 FAIL |
| 64^3 R=3, best shape (8x8x4 b1, 256 thr) | 1.6 | 2.04 FAIL | 0.50 / 0.79 / 0.65 PASS |
| 64^3 R=3, literal 8x8x8 workgroup, b1, split | 1.6 | 2.58 FAIL | 0.82 (run 2) / 0.67 (run 3) PASS |
| 64^3 R=4, literal 8x8x8 workgroup | 4.5 | invalid (zeros, below) | 10.9 (run 2) FAIL |
| slab 256x256x8 R=3, specified | 3.3 | 94.0 (cliff artifact) | 2.64 PASS / 2.70 PASS / 3.48 FAIL |
| slab R=3, split | 3.3 | 7.36 FAIL | 3.71 / 3.71 / n/a FAIL |
| slab R=4, specified | 8.9 | 184.6 (cliff artifact) | 19.9 / 15.5 / n/a FAIL |
| slab R=4, split | 8.9 | 34.8 FAIL | 22.8 / 17.75 / n/a FAIL |

"Best shape" at R=3 (8x8x4 block 1) is the plan's ablation 3 (PLAN.md:75); the other tuned shapes and the literal 8x8x8 are not in the plan; the specified shader was judged first and the tuned rows are reported separately. Neither tuned shape nor 8x8x8 rescues R=4 in Deno.

Housekeeping: the run-2 Chrome JSON had a leaked `[page]` console line stripped by hand (run.mjs now writes page messages to stderr); port 5291 was taken by another session so runs used 5293-5295 (`BL_BENCH_PORT`).

Run 4 (diagnostic only): Chrome with `--enable-dawn-features=disable_robustness` (not a shippable setting) leaves the 2D pass at 204 us and speeds up the 3D shared-memory kernels: R=3 specified 1.62x, R=3 split 1.43x, R=3 8x8x4 b1 0.60x, R=4 8x4x4 b1 3.99x (813 us, versus 1496-1530 us with bounds checks). So Dawn's robustness clamping on the unrolled shared-memory reads accounts for roughly half of the 3D R=4 time in Chrome and none of the 2D pass time. It does not explain the slow Chrome 2D baseline.

## Correctness (bit for bit against a CPU loop, before any timing)

Deno: 16^3 R=3, R=4, 16x16x8 R=3, R=4, R=3 block 1, wg 8x8x4 block 1, 32^3 R=4, plus the split shader at 16^3, 16x16x8 and 32^3 (R=3 with 4 declarations): all exact (about 132 distinct U values each, so growth() is exercised across its range). Every sweep shape is checked at 32^3 before it is timed and a mismatch throws in Deno; one shape was rejected by this gate (R=4 8x8x8, below).
Chrome: 16^3 R=3/4, single and split, exact; every sweep shape exact at 32^3 before it was timed. A mismatch now throws in the browser harness too (it previously logged "FAIL" and went on; no saved run recorded a mismatch).
Kernel asserts: tap counts 92 / 250 / 460 for R=3/4/5; sums 9624 / 22710 / 44436; 2D R=9 224 taps (sum 26352); dz=0 reproduces `buildKernel` for R in {3,4,9}; closed under all 48 axis permutations and sign flips; `250*255*16383 < 2^32`.

R=4 with the literal 8x8x8 workgroup (4096-word tile, exactly the 16 KiB single-workgroup size, 512 invocations) in Deno returns all zeros with no GPU error, for 1, 2, 4 or 8 declarations (`probe-8x8x8.ts`), while R=3 8x8x8 is exact. That is a silently skipped dispatch, which is the reason the skeptic saw about 0 us. The cause was not isolated; one candidate is that the pipeline's real thread limit falls below 512 for the big unrolled body, which would also fit the high register pressure seen at R=4. It is recorded as invalid, not as a slow result.

## Method

- Timing: GPU timestamp queries, one compute pass per dispatch with begin/end stamps, one reused query set. Trials are ABBA-interleaved; each trial is a batch of up to 200 dispatches reduced to its median; the reported number is the median of trial medians, 15 trials, rerun with 30 when any p90/p10 exceeds 1.15 (done automatically in both stacks now). Warmup is 50 dispatches per variant (the first run used 20). Batches are capped near 120-150 ms of GPU time, so slow variants run fewer than 200 dispatches per trial (a command buffer of seconds hangs the Metal queue).
- Validity: every timestamp batch is checked for zero or negative durations and for quantisation (fewer than 4 distinct values in 20 or more samples); a failing batch, or any other failure inside a timestamp batch (mapAsync, device loss), falls back to a wall-clock batch for that trial with a warning, and counts are recorded (`timing` in the JSON: Deno 1013 batches, Chrome 1269, zero fallbacks, zero dropped samples). The profile samples taken from the real GpuSim pass go through the same check, but a failure there throws instead of falling back. The quantisation check can only fire on batches of 20 or more samples, so it never applies to the slow variants (5-14 dispatches per batch). Chrome's developer flag keeps timestamps unquantised; the wall-clock rerun agrees (see below). The general fallback is real now, but it was never triggered in these runs.
- T2: method A is the real `GpuSim` affinity pass in a live step (profile hook, Deno only, 87.5 us); method B is the unmodified `affinityShader` on its own buffers (80.2 us in Deno, the Chrome baseline). A vs B differ by 8.4% here (bar 10%).
- 3D shaders: `shader3d.ts`, tap rule extended from `buildKernel`, shared tile of (block*wg+2R)^3 words, all cells take the genome branch (the slow side; the 2D generalist world has 5,208 of 65,536 cells with lineage and the all-alive 2D copy is 2-4% slower, so this slightly favours 2D).
- Predicted ratio is taps x cells over the 2D pass (1.64 for 64^3 R=3, 4.46 for R=4, 3.29 slab R=3, 8.93 slab R=4). It ignores the per-cell epilogue (growth, writes), which R=3 pays on 4x the cells for 1.64x the taps, so the 1.6x bar is not a whole-pass cost prediction. It is the bar the plan set.
- Wall-clock cross-check: wall time of a 100-200 dispatch single pass is 1.12-1.82x the timestamp time in Deno for the 3D variants (the split R=3 and slab variants are at the top: 1.76-1.82x), 2.0-2.3x for the 2D pass and the 27-source stub, and 1.06-1.54x in Chrome. Timestamps do not count gaps between passes. Ratios were not re-derived from wall time because the 2D denominator inflates more than the 3D ones; the skeptic's differential wall measurement is below. Wall-clock does not change the side of any bar in Deno.

## Deno run 2 (timestamp queries, 15 trials, 30 where p90/p10 > 1.15)

| variant | taps | cells | median us | p10 | p90 | Gtap/s | ratio vs T2 | predicted |
|---|---|---|---|---|---|---|---|---|
| 2D R=9 256^2, A: real GpuSim pass (profile hook) | 224 | 65536 | 87.5 | 86.8 | 89.6 | 167.7 | 1.00 | 1.00 |
| 2D R=9 256^2, B: unmodified affinityShader, isolated | 224 | 65536 | 80.2 | 79.6 | 83.7 | 183.1 | 0.92 | 1.00 |
| 2D, B with every cell on the genome branch | 224 | 65536 | 83.5 | 81.3 | 166.6 | 175.8 | 0.95 | 1.00 |
| 3D 64^3 R=4 (single declaration) | 250 | 262144 | 8906 | 8372 | 9191 | 7.4 | 101.8 | 4.46 |
| 3D 64^3 R=3 (single declaration) | 92 | 262144 | 4538 | 4399 | 4708 | 5.3 | 51.9 | 1.64 |
| 3D slab R=3 (single) | 92 | 524288 | 8225 | 7871 | 8715 | 5.9 | 94.0 | 3.29 |
| 3D slab R=4 (single) | 250 | 524288 | 16158 | 15118 | 16994 | 8.1 | 184.6 | 8.93 |
| 3D 64^3 R=4 split | 250 | 262144 | 1683 | 1562 | 1719 | 38.9 | 19.2 | 4.46 |
| 3D 64^3 R=3 split | 92 | 262144 | 320.6 | 318.1 | 333.1 | 75.2 | 3.66 | 1.64 |
| 3D slab R=3 split | 92 | 524288 | 644.5 | 639.1 | 654.9 | 74.8 | 7.36 | 3.29 |
| 3D slab R=4 split | 250 | 524288 | 3046 | 2927 | 3151 | 43.0 | 34.8 | 8.93 |
| 27-source transport stub 64^3 | 27 | 262144 | 130.0 | 127.1 | 141.2 | 54.4 | 1.49 | |

Run 1 gave the same picture within about 10% (R=4 split 1899 us, R=3 split 350 us, T2 86.4 us). Real 2D pass medians in a live step (us): affinity 86.2, flow 19.3, transport 157.7, react 283.5, tick 4.9. The 27-source stub (4x the cells, 27 loads) costs 130 us against 157.7 us for the real 2D transport pass; the stub is not the real transport, so this says only that a simple per-cell gather scales with cell count.

Single-declaration rows are the wgpu/Metal workgroup-storage cliff (next section), not 3D cost; do not quote them as 3D cost. The split and tuned rows are the real Deno comparison.

## The Deno workgroup-storage cliff

A minimal kernel (shared write, barrier, shared read, one output write; no loads, no taps; `probe-zeroinit.ts`, `probe-zeroinit2.ts`; 512 workgroups; run once, in run 1) with one `var<workgroup>` array, Deno/wgpu on this Mac:

| tile | one declaration | two declarations | four | eight |
|---|---|---|---|---|
| 2048 B | 10 us | | | |
| 4096 B | 15 us | | | |
| 8192 B | 28-81 us | | | |
| 10976 B | 3939 us | 120 us | | |
| 12288 B | 4433 us | | | |
| 16384 B | 7035-7061 us | 133 us | 125 us | 101 us |

A vec4 array, a struct of two arrays and an array of arrays at 16 KiB are all still about 7040 us; only separate top-level variables avoid it. The cost appears per declaration above roughly 8 KiB. This is consistent with a workgroup zero-initialisation loop emitted for large declarations, but that is a hypothesis: the generated Metal source was not inspected. In Chrome the same minimal kernel costs 34-49 us (one declaration) and 21-78 us (two); there is no cliff. The 7.2 ms "halo-only" figure on the first Deno run was this cost. With the tile split, halo-only (shared reads, barrier and the full per-cell epilogue, but no taps) is 211 us at R=4 and 143 us at R=3. Those numbers are not an additive decomposition (there is no 2D halo-only counterpart, and the epilogue and reads are included), so they show only that R=4 with taps costs far more than R=4 without them; they do not show that "the remaining time is tap work".
The split version adds a compare per tap (`ld()`/`st()` select the declaration), which is why split is slower than single in Chrome (1.9-2.4x vs 1.4-1.76x at R=3).

## Ablations and sweep (Deno, split or sub-cliff tiles, 64^3, run 2)

| variant | median us | Gtap/s | ratio vs T2 (80.5-87.5) |
|---|---|---|---|
| R=4 split | 1637 | 40.0 | 18.7 |
| R=3 split | 318.5 | 75.7 | 3.64 |
| R=4 split, halo only | 210.6 | | 2.41 |
| R=3 split, halo only | 142.7 | | 1.63 |
| R=4 split 4 decl / 8 decl (INVALID: both ran 2 declarations, bug fixed after review; see the M3 Pro section) | 1681 / 1609 | 39.0 / 40.7 | 19.2 / 18.4 |
| R=4 block 1, wg 4x4x4 | 1601 | 40.9 | 18.3 |
| R=3 block 1, wg 4x4x4 | 233.7 | 103.2 | 2.67 |
| R=4 wg 8x8x4 block 1 (256 thr) | 3713 | 17.7 | 42.4 |
| R=3 wg 8x8x4 block 1 (256 thr) | 175.0 | 137.8 | 2.00 |
| sweep R=3 wg 8x4x4 / 8x8x2 b1 | 191.6 / 207.5 | 125.9 / 116.3 | 2.35 / 2.55 |
| sweep R=3 wg 8x8x8 b1, split (512 thr, literal plan shape) | 210.0 | 114.8 | 2.58 |
| sweep R=4 wg 4x4x4 b1 | 1582 | 41.4 | 19.4 |
| sweep R=4 wg 8x8x8 b1, split | invalid, zeros | | |

(The other single-declaration sweep rows over about 8 KiB, for example R=4 8x4x4 b1 at 20.6 ms, are cliff rows and are not used.) Tap throughput at R=4 stays at 35-41 Gtap/s whatever the tile, against 168-183 for the 2D pass and 115-145 for R=3 tuned. R=4 loses per tap for a reason this benchmark did not isolate (candidates: the 250-line unrolled body, register pressure or spilling, which the invalid 8x8x8 dispatch also hints at; not tested). In Chrome the robustness-off run recovered about half of it.

## Chrome runs (Dawn, timestamp queries, 15 trials of up to 100 dispatches, rerun with 30 where p90/p10 > 1.15)

Run 2 (all rows) is `data/chrome-m1max.json`; run 1 (9 trials, 20 warmup, summaries only) and run 3 are kept next to it. The table lists run 1, run 2 and run 3 medians (us) for the main rows; run 2 spread (p90/p10) reached 1.5 on small kernels because the machine was loaded, run 3 spread was 1.00-1.03.

| variant | run 1 | run 2 | run 3 | Gtap/s (run 3) |
|---|---|---|---|---|
| 2D R=9 256^2 (affinityShader, isolated) | 274.1 | 272.5 | 203.2 | 72.2 |
| 3D 64^3 R=4 single | 2590.6 | 2285.9 | 2246.0 | 29.2 |
| 3D 64^3 R=4 split | 3080.5 | 2623.7 | | |
| 3D 64^3 R=3 single | 388.3 | 395.9 | 357.9 | 67.4 |
| 3D 64^3 R=3 split | 530.1 | 542.3 | 489.9 | 49.2 |
| slab R=3 single | 723.1 | 736.9 | 706.5 | |
| slab R=3 split | 1015.7 | 1011.5 | | |
| slab R=4 single | 5451.5 | 4217.0 | | |
| R=3 wg 8x8x4 b1 | 137.3 | 215.3-220.7 | 132.0 | 182.7 |
| R=3 wg 8x8x8 b1 (split) | | 223.8 | 135.6 | 177.8 |
| R=4 wg 8x4x4 b1 | 1697.6 | 1529.4 | 1495.8 | 43.8 |
| R=4 wg 8x8x8 b1 (split) | | 2978.4 | | |

Chrome wall-clock agrees with timestamps within 6-54% (1.06-1.54x, the largest on R=4 small-batch variants), with the same classification for every bar except where noted in the ratio table. Run 2 tuned R=3 (215-221 us against 132-137 in runs 1 and 3) is the contended run; the specified R=3 rows moved by 10% or less between runs.

## Skeptic's independent remeasure (Deno, wall clock only)

`skeptic_wall.ts`: pure wall-clock differential (T(3N)-T(N))/(2N) inside one compute pass, N=100, 15 trials, so fixed submit and sync overhead cancels. Same M1 Max.

| variant | skeptic us | skeptic ratio | implementer |
|---|---|---|---|
| T2: unmodified 2D affinityShader, R=9 | 80-98 (all-alive 90-94) | 1.00 | 86.4 |
| 64^3 R=4, 4x4x4 b2 split | 1563-2271 | 17.7-26x | 22x |
| 64^3 R=4, 4x4x4 b1 split (best) | 1564 | 17.7x | 20.1x |
| 64^3 R=4, 8x4x4 b1 split | 2453 | 27.8x | |
| 64^3 R=4, 8x8x4 b1 split | 3043 | 34.5x | 40.5x |
| 64^3 R=3, 4x4x4 b2 split (as specified) | 312 | 3.55x | 3.9-4.05x |
| 64^3 R=3, 8x8x4 b1 (tuned) | 164 | 1.86x | 1.99x |

The skeptic's numbers agree with the implementer's within about 7% (and the R=4 shape bests are 17.7x and 19.4x). Bars: 4.5 for R=4 and 1.6 for R=3, so R=4 fails by about 4x or more and R=3 fails in Deno. The 8x8x8 R=4 variants the skeptic tried returned about 0 us; this is the invalid zero-output dispatch above, and the R=3 8x8x8 split shape is now measured (210 us, 2.58x). The skeptic did not remeasure Chrome, the slab, or the 27-source stub. The skeptic's note on method: one pass per dispatch or one submit per dispatch inflates small kernels (the 2D baseline reads 139-190 us that way), which would flatter 3D ratios if used as a denominator. All reported ratios use a denominator measured by timestamps in one batch.

## Review findings and what was done

- P1 verdict depends on a rule change: accepted. The verdict now says Deno STOP, Chrome run-dependent, lead must re-rule; the earlier "pass-via-fallback" is withdrawn.
- P2 browser correctness gate: accepted and fixed; a mismatch throws in `web.ts`.
- P2 timestamp validation: accepted. Zero/negative duration and quantisation checks, per-batch wall fallback, validated profile samples; the fallback never triggered in the reruns.
- P2 cliff diagnosis overstated: accepted. Reworded to "consistent with" and the additive attribution dropped; the generated Metal/Tint code was not inspected.
- P3 plan departures: accepted. Warmup is 50 now, Chrome runs 15 trials with an automatic 30-trial rerun and saves trial arrays; the wall-clock range is corrected; the note on the epilogue is in Method.
- P3 Deno remeasure and fairness check: no change needed; recorded above. The note that the 2D world has fewer cells on the genome branch is in Method.
- P2 Chrome pass depends on the slow 2D baseline: accepted and shown directly. Gtap/s is reported next to every ratio, the pass flips with the 2D baseline across three runs, and a robustness-off run shows what Dawn's bounds checking costs. Why Chrome's 2D pass is 2.5-3.4x slower than Deno's was still not found: it is not robustness (2D unchanged with it off).
- P3 8x8x8 never benchmarked: accepted and done. R=3 8x8x8 split works (210 us Deno, 2.58x; 135-224 us Chrome); R=4 8x8x8 returns zeros in Deno and is recorded as invalid; in Chrome R=4 8x8x8 runs correctly (2978 us, 10.9x).
- P3 timing caveats: accepted; cliff rows are never quoted as 3D cost.

## Notes and limits

- Metal counter sample buffers: one reused query set per device, GpuSim profile steps in chunks of 40.
- `pnpm typecheck` was not run: `tsconfig.json` includes only `packages/*/src`, `apps/lab/src`, `apps/lab/test` and `tests`, none of which changed. `experiments/3d-bench/test/kernel3d.test.ts` is outside the vitest include globs; `bench.ts` runs the same asserts at startup.
- No file outside `experiments/3d-bench/` (plus `docs/3d-rung1a-bench-2026-10-22.md`) changed; nothing committed. `tests/deno/gpu_golden.ts` was not rerun because no covered file changed.
- Machine load was high during all runs (load average about 500), which shows as extra spread in Chrome run 2; every ranking above held in the quiet run 3 except where the ratio flips are called out.

## Second machine: work Mac, Apple M3 Pro (Deno, idle GPU), added 2026-10-22

Same harness and shaders, run over SSH on an otherwise idle machine (load average about 4, against about 500 on the M1 Max). Raw data: `data/deno-m3pro.json`, `data/deno-m3pro.log`.

Harness changes made for this run (and after the pre-commit Codex Sol review):
- Metal on the M3 Pro stamps a zero duration on 1-2 of 200 samples of the *other* three short passes in a live GpuSim step (flow, react, tick), which aborted the run three times. `bench.ts` now validates only the two passes it reads (affinity, transport) and counts zeros on the rest (2 dropped; 0 fallback batches).
- T2 now follows PLAN.md:41: A (the real in-step pass) unless A and B disagree by more than 10%, then B. On the M3 Pro A = 113.7 us and B = 98.8 us (B/A = 0.869), so **T2 = B = 98.8 us**, in the main run and in the sweep. (An earlier draft of this section divided by A, which flattered every ratio by about 15%.) On the M1 Max A and B agree within 8.4%, so its T2 stays A.
- The 4- and 8-declaration ablations previously ran with 2 declarations (a trailing default overrode them). Fixed; the M1 Max rows for them below are therefore invalid and were not rerun.

| check | bar | M3 Pro (Deno, T2 = B) | M1 Max (Deno, T2 = A) |
|---|---|---|---|
| 64^3 R=4 specified | 4.5 | 28.9 (cliff) | 101.8 (cliff) |
| 64^3 R=4 split | 4.5 | 11.3 FAIL | 19.2 FAIL |
| 64^3 R=4 best shape (4x4x4 b1) | 4.5 | 7.31 FAIL (722 us) | 18.3-19.4 FAIL |
| 64^3 R=3 specified | 1.6 | 12.1 (cliff) | 51.9 (cliff) |
| 64^3 R=3 split | 1.6 | 2.45 FAIL | 3.66 FAIL |
| 64^3 R=3 wg 8x8x4 b1 (plan ablation 3) | 1.6 | **1.09 PASS (108 us)** | 2.04 FAIL (166 us) |
| 64^3 R=3 8x4x4 b1 / 4x4x4 b1 | 1.6 | 1.17 / 1.43 PASS | n/a |
| 64^3 R=3 literal 8x8x8 split | 1.6 | 1.78 FAIL | 2.58 FAIL |
| slab R=3 split | 3.3 | 4.81 FAIL | 7.36 FAIL |
| slab R=4 split | 8.9 | 22.0 FAIL | 34.8 FAIL |
| 64^3 R=4 split, 4 / 8 declarations | 4.5 | 17.4 / 22.9 (more declarations are slower) | invalid (ran 2) |
| 27-source transport stub / real 2D transport | - | 0.54 (103.5 vs 193.2 us) | - |

Reading: the plan's primary geometry (the specified shader, and its split twin) STOPs on both machines, and 64^3 R=4 fails everywhere. The plan's own ablation 3, the 256-thread 8x8x4 block-1 shape at R=3, passes on the M3 Pro in Deno (1.09x) and in Chrome on the M1 Max (0.50-0.79x), and fails only in Deno on the loaded M1 Max (2.04x). So: **primary geometry STOP; planned-ablation shape passes on two of three stack/machine pairs.** In absolute terms, 64^3 at R=3 costs about one of today's affinity passes (0.1-0.2 ms) and R=4 costs 0.7-3 ms. Whether to re-rule to "R=3, 8x8x4 block 1, go" is the user's call.

## Amendment 2026-10-23: re-ruled to GO at R=3

After reading the results above, the user re-ruled rung 1a to **go with R=3**, using the plan's ablation-3 shape (workgroup 8x8x4, block 1, one tile declaration). This is a decision made after seeing the data, not an outcome of the pre-stated rule, which still reads STOP for the primary geometry. Grounds: that shape passes its 1.6x bar on the idle M3 Pro in Deno (1.09x, 108 us) and in Chrome on the M1 Max (0.50-0.79x), fails only in Deno on the M1 Max while that machine was at load average ~500 (2.04x, 166 us), and in absolute terms costs about one of today's 2D affinity passes. R=4 stays out. The 3D line carries R=3 and this workgroup shape into rung 1b.
