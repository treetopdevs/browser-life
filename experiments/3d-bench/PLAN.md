# Rung 1a: 3D affinity benchmark (throwaway) — plan

Source: docs/3d-brainstorm-2026-10-22.md sections 3 and 5. No physics, shader, schema or golden file is touched. All code lives in `experiments/3d-bench/`; the only file outside is an optional lab page (step 7).

## Question and pass rule (fixed before any run)

T2 = median time of today's 2D affinity pass, 256x256, R=9 (224 taps).
T3(R) = median time of the 3D affinity pass over 64^3 (262,144 cells = 4x the cells).
- Pass: T3(R=4) <= 4.5 x T2. (250 taps x 4 cells / 224 taps = 4.46x: the "tiling still pays in 3D" ratio.)
- Else R=3 (92 taps, predicted 1.6x): pass if T3(R=3) <= 1.6 x T2 (exact bar; report the margin).
- Else slab 256x256x8 (524,288 cells = 8x): R=3 pass if <= 3.3 x T2; R=4 pass if <= 8.9 x T2.
- Every variant is judged only against its own predicted ratio (taps x cells / 14.7 M). If none passes: verdict STOP.
- Ratios are computed from medians; report also min/p90 and the ratio of the 2D+3D tap throughput (Gtap/s) so a miss is interpretable.

Note the 3D case is structurally harsher than the ratio assumes: 2D R=9 loads a 34x34 = 1,156-word tile for 256 cells (4.5 words/cell), 3D R=4 loads 16^3 = 4,096 words for 512 cells with a (2x2x2) block (8 words/cell). Report halo-load cost separately (variant with taps removed, see Ablations) so a fail can be attributed to halo vs tap work.

## Files

- `experiments/3d-bench/kernel3d.ts` — `buildKernel3(radius)` returning `{radius, taps: Int32Array (dx,dy,dz,w), count, sum}`. Pure BigInt, mirrors `buildKernel` in packages/schema/src/kernel.ts line for line: d2 = dx^2+dy^2+dz^2; skip d2 == 0 or d2 >= R^2; `r = isqrt(d2<<32)/R`; `t = (4r(ONE-r))>>16`; `t4 = (t^4)>>48`; `w = (t4*255 + ONE/2)>>16`; skip w == 0. Imports nothing from sim-ref; may import `buildKernel` only to cross-check.
- `experiments/3d-bench/shader3d.ts` — `affinity3dShader({side, radius, tile, block})` string generator (WGSL).
- `experiments/3d-bench/transport27.ts` — the 27-source transport stub shader.
- `experiments/3d-bench/harness.ts` — device setup, buffer fill, timing (timestamp queries with wall-clock fallback), median/stats, table output. Runs under Deno and in a browser (no Deno-only APIs; navigator.gpu injected).
- `experiments/3d-bench/bench.ts` — Deno entry: `deno run -A --no-lock experiments/3d-bench/bench.ts [--trials=15] [--iters=200] [--json=out.json]`.
- `experiments/3d-bench/test/kernel3d.test.ts` (vitest if the glob picks it up; the same checks also run as startup asserts in bench.ts) — tap counts and sums.
- Optional: `apps/lab/bench3d.html` + `apps/lab/src/bench3d.ts` importing the harness through a relative path (needs a vite multi-page entry check; see step 7). No change to vite aliases unless unavoidable.

## 3D kernel generation (exact, integer)

`buildKernel3(R)` as above. Startup asserts (hard fail, no benchmark otherwise):
- count(R=3) == 92, count(R=4) == 250, count(R=5) == 460 (doc table); buildKernel(9).count == 224, and the 2D-specialisation check: a local `buildKernel3` with dz forced to 0 reproduces `buildKernel(R).taps` exactly for R in {3,4,9}. This proves the generator is the same rule.
- sum <= 2^32 / (16383) bound: count*255*16383 < 2^32 (250*255*16383 = 1.04e9 ok), asserted.
- Symmetry: taps closed under all 48 signed axis permutations (cheap sanity).

## 2D baseline: isolates ONLY the affinity pass

Two measurements, cross-checked against each other:

A. Real pipeline, profile hook (primary): `defaultConfig({tileW:256,tileH:256,seed:42})` (R=9 default — assert `cfg.kernelRadius === 9`), `generalistWorld(cfg, 12)`, `requestDevice`, `GpuSim.create`, warm 200 steps so the world is populated (lesser cost variance), then set `sim.profile = {set: querySet(capacity 2*5*N), next: 0}` and encode N steps via `sim.encodeStep(enc)`; each step writes 5 pass timestamps pairs, affinity is pair k = 5*s. Resolve with `resolveQuerySet` + staging buffer map, take (end - begin) of every 5th pair. This times exactly the affinity pass inside the real step, with the real bind groups and live data. (Caveat: `encodeStep` advances the sim; that is fine.) If the device lacks `timestamp-query`, use B only.

B. Isolated copy (the fallback and the apples-to-apples twin): build `affinityShader(cfg)` (imported from `@bl/sim-gpu` shaders.ts, unmodified) into my own pipeline with `layout:"auto"`, bind `cells`, `genome`, `U` buffers sized from `cellCount(cfg)` with `CELL_CHANNELS`/`GENOME_CHANNELS`, filled from `generalistWorld`'s state (encode via the same layout as `GpuSim.upload`; if that is private, run A's sim, `readState`-free: simply `sim.upload(init)` then read back nothing and take no buffers — instead construct the buffers by copying the public layout constants). Dispatch `ceil(256/16)^2 = 16x16` workgroups (affinityBlock = 2 since 256 % 16 == 0) repeated `iters` times per submission.
  Cross-check: A and B medians must agree within ~10%; if not, report both and use B as T2 for the ratio *and* mention A. (Use A as T2 when available: it is the real pass; B is the fallback.)

Both are data-independent except the `genome != 0` branch; seeding with the generalist world (all alive) puts the 2D case on its slow branch. The 3D buffers are filled so that the same branch is taken for every cell (genome lineage words nonzero, params mu/sigma set), so the comparison is not skewed.

## 3D shader: mirrors the 2D one

Generated like `affinityShader`: shared-memory tile with halo, fully unrolled compile-time taps, 2x2x2 register blocking as the 3D analogue of Bk=2.

- Geometry: workgroup (4,4,4) = 64 threads, block 2 per axis, so a workgroup owns CB = 8 cells per side (512 cells). Halo tile SW = CB + 2R: R=3 -> 14^3 = 2,744 words (10.7 KiB); R=4 -> 16^3 = 4,096 words = 16,384 B = exactly the 16 KiB default `maxComputeWorkgroupStorageSize` (the doc's "R 4 fills it exactly"). Also assert `device.limits.maxComputeWorkgroupStorageSize >= needed` and log the adapter value (Apple reports 32 KiB; but request nothing above default so the result is portable). A WG of 8x8x8 would be 512 invocations > default `maxComputeInvocationsPerWorkgroup` 256, so it is not used. Slab: the same shader with a non-cubic world (sizeX, sizeY, sizeZ params).
- Slab tiling: depth 8 with CB=8 means one workgroup layer in z, halo SW_z = 8 + 2R. Fine, generator takes per-axis sizes. z neighbours wrap or clamp: use wrap (like the 2D torus) so the load is branch-free; the cost is the same either way.
- Cooperative load: `for (k = li; k < SW^3; k += 64) { decode (x,y,z), wrap-index into the world, sm[k] = min(cells[CH_B + j] + cells[CH_P + j], 16383u) }` — same expression and same `min` as 2D. The index math is the 3D `nb` (tile = whole volume, wrap with `%`, same i32/u32 handling as the 2D nb). cells buffer has 2 channels used (B, P) at stride n like CH_B/CH_P; buffer sized with the real CELL_CHANNELS*n so the memory footprint of strides matches.
- Convolution: for each (dx,dy,dz) in the union of the 8 block-shifted tap sets, one `let v = sm[b + off]` and up to 8 `conv[q] += Wu * v;` lines, identical in form to the 2D generator (`wmap` keyed by "dx,dy,dz"). u32 only; no integer overflow (bound asserted above).
- Epilogue, per cell: `uq = conv[q] / KSUM; uu = min((uq*1024u)/MASS_UNIT, 4095u)` with the same constants as the 2D prelude (copy MASS_UNIT and KSUM semantics; KSUM = the 3D tap sum), the same `genome[G_LIN_HI+i] | genome[G_LIN_LO+i]` test and `G_PARAM0` read, `growth(...)` copied verbatim, store `U[i] = growth(...)` (i32). So the per-cell fixed work, memory traffic (genome reads, U write) and divides match 2D; only the tap list and index math differ. The growth function text is copied from shaders.ts into shader3d.ts (not imported; it is not exported).
- Correctness check (kept cheap, mandatory): CPU reference of the 3D convolution in kernel3d.ts for a small volume (16^3, R=3 and 4, random B/P from a seeded integer PRNG) compared with the GPU `U` readback for the full volume bit for bit. A benchmark of a wrong kernel is meaningless. Reuse this same shader generator for 16^3 and 64^3 (only constants change).
- 64^3 = 262,144 cells -> dispatch 8x8x8 workgroups (CB 8). 256x256x8 -> 32x32x1.

## 27-source transport stub

Trivial pass, one thread per cell (workgroup 4x4x4), reads the 27 neighbours' `disp`-like word (u32) and the cell's source channel, accumulates 27 loads with the same wrap indexing, writes one u32 into `cellsOut`. It is deliberately not the real transport (no stochastic rounding, no ledger): it measures the memory-bound cost of a 27-point gather at 64^3, to give the order of magnitude for "other passes scale with cell count". Also time the real 2D transport pass (hook pair index 2 of 5 in method A) at 256^2 for the ratio, and report 3D-stub / 2D-transport next to the 4x cell ratio. Not part of the pass rule.

## Timing method

- Primary: `timestamp-query` via `timestampWrites` on one compute pass per dispatch (same as the existing profile hook), N=`iters` dispatches per submission each with its own begin/end pair, resolved to a buffer and read once per trial. Per-dispatch durations (ns, BigInt differences) pooled.
- Fallback when the feature is missing (or Deno reports zero/non-monotonic stamps): `iters` back-to-back dispatches in one pass, `await device.queue.onSubmittedWorkDone()`, wall time / iters. Always reports which method was used.
- Warmup: 50 untimed dispatches per pipeline (shader compile and clock ramp). Pipelines compiled with `createComputePipelineAsync` before timing.
- Order: interleave variants (2D, 3D R4, 3D R3, slab, ...) ABBA across trials rather than finishing one variant, to spread thermal drift on a laptop GPU.
- Trials: 15 trials x 200 dispatches; per trial take the median; final value = median of trial medians; also print min, p10, p90, and relative spread (p90/p10). If spread > 15%, rerun automatically once with 30 trials and flag it.
- Environment printed with results: adapter info, whether the machine is on power, timestamp-query availability, `maxComputeWorkgroupStorageSize`, `maxComputeInvocationsPerWorkgroup`.
- Results written as JSON + a markdown table to stdout (not to a report file in the repo; the lead copies what it needs).

## Ablations (cheap, to explain a miss)

1. Halo-only variant (loads + barrier + one write, no taps) for 2D and 3D: isolates halo-load cost.
2. Block 1 (no register blocking) vs block 2 in 3D, R=3 and 4: shows whether blocking pays in 3D.
3. A (8,8,4)=256-thread, block 1 variant for R=3 (tile size computed by the generator) as an occupancy alternative; skipped for R=4 if storage > 16 KiB.
Only run if the primary verdict is a fail or within 15% of the bar.

## Browser (lab) run — nice-to-have, after Deno works

Same harness module, run from a page: `apps/lab/bench3d.html` + `bench3d.ts` that imports `experiments/3d-bench/harness.ts` and `shader3d.ts` (vite `server.fs.allow`/relative import across the workspace; if the dev server refuses files outside `apps/lab`, copy via a one-line alias in a throwaway local vite config under experiments/3d-bench/, NOT editing apps/lab/vite.config.ts). The browser run has no `@bl/sim-gpu` GpuSim profile hook problem (it is plain code), but Chrome only exposes timestamp-query with `--enable-unsafe-webgpu`/ `chrome://flags` "WebGPU developer features" (timestamps quantised to ~100us unless that flag is set), so the browser run uses the wall-clock fallback with iters large enough (>= 200 dispatches per measurement) that quantisation is irrelevant. Drive it with Playwright using the repo's WebGPU Chrome flags (tests/e2e config) or the Browser pane on `pnpm dev`; results read from `window.__bench3d` and printed. Browser T2 baseline = method B (isolated affinityShader) because GpuSim's profile hook needs timestamps. Deno result is authoritative; the browser result is reported next to it and any disagreement > 25% is noted, not adjudicated.

## Order of work (implementation phase)

1. `kernel3d.ts` + asserts (tap counts 92/250/460, 2D specialisation equals buildKernel).
2. `shader3d.ts` + CPU reference + GPU bit-for-bit check at 16^3 (R=3, R=4) under Deno.
3. `harness.ts` timing + 2D baseline (methods A and B, cross-check).
4. 3D runs: 64^3 R=3, R=4; slab 256x256x8 R=3, R=4; 27-source stub.
5. Verdict table with the pass rule above; ablations only if needed.
6. `pnpm typecheck` is not required for experiments/3d-bench unless included by tsconfig (check `tsconfig.json` include globs; if it picks the folder up, make it typecheck clean or exclude it in the folder via a local tsconfig, not the root one).
7. Browser page and Playwright run if time allows.

## Guardrails

- No edits under packages/sim-ref/src, packages/sim-gpu/src/shaders.ts, packages/sim-gpu/src/gpu-sim.ts, packages/schema/src, or golden pins. `git status` must show only `experiments/3d-bench/**` (and the optional lab page files) at the end; `deno run -A tests/deno/gpu_golden.ts` need not be rerun because nothing it covers changes, but run it once as a sanity check if the GPU is available.
- No commits, no bookmarks, no pushes.
- Deno runs always with `--no-lock`; node via PATH=~/.nvm/versions/node/v24.2.0/bin:$PATH.

## Risks / open points

- 3D tile load is 8 words per owned cell vs 4.5 in 2D, so a fail at R=4 may be halo-bound, not tap-bound; ablation 1 separates this.
- Deno's WebGPU may not honour `timestampWrites` precision on every adapter; fallback is built in.
- `maxComputeInvocationsPerWorkgroup` 256 forces the 64-thread/block-2 layout; occupancy at 16 KiB shared per workgroup (R=4) is limited by shared memory (Apple GPUs: likely 1-2 workgroups per core); that is part of the answer, not a bug.
- Method A mutates a GpuSim only; method B must not alias A's buffers.
