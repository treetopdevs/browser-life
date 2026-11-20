# Phase B2: Bit-Exact Integer WebGPU Port (`128×128`–`256×256`, 100+ Droplets) (2026-11-20)

Code:
- `apps/lab/src/oligomer/droplets-kernel.ts` — Fixed-point integer CPU reference (`DropletKernelRef`, `SCALE = 1024`, `Q16` rates, zero floats in `step()`) + pure observers (`observeTotalMatter`, `observeMotifStats`, `observeFindDroplets`, `observeDigest`).
- `apps/lab/src/oligomer/droplets-shaders.ts` — Bit-exact WGSL compute shaders (6 barriered passes per step, 4 storage buffers — under WebGPU's universal limit of 8 — zero atomics, pull-based isotropic integer diffusion, parallel priority-resolved `r = 3` conserved motif isomerization).
- `apps/lab/src/oligomer/droplets-gpu.ts` — `DropletGpuSim` batched WebGPU runner (`step(n)` encodes up to 128 steps per command submission).
- `tests/deno/droplets_gpu_golden.ts` — Native WebGPU CPU↔GPU bit-for-bit golden test (4/4 regimes pass identically with `res = 0`).
- `apps/lab/test/droplets-kernel.test.ts` — Vitest unit tests for `DropletKernelRef` (4/4 pass).
- `experiments/oligomer/phage-gpu-run.ts` — Large-arena WebGPU experiment runner (`128×128`, `256×256`).

## Bit-for-Bit Parity (`deno run -A tests/deno/droplets_gpu_golden.ts`)

| Golden case | Grid | Steps | CPU & GPU Digest | Residual | Status |
|---|---|---|---|---|---|
| Multi-motif droplets (no phage, no mut) | `32×32` | 300 | `f50eda7d` | `0` | PASS |
| Specialist `PHAGE` + high `mutMotif` + `mutPhage` | `32×32` | 300 | `12458855` | `0` | PASS |
| `NEUTRAL_PHAGE` + high `mutMotif` + `mutPhage` | `32×32` | 300 | `a4a45bb1` | `0` | PASS |
| Dark world dissolution (`kLight = 0`) | `24×24` | 200 | `dc5cbed7` | `0` | PASS |
| Large-arena `128×128` `PHAGE` + `mutMotif` parity | `128×128` | 40 | `e07ee103` | `0` | PASS |

## Large-Arena Kill-the-Winner Experiment (`128×128`, 20,000 steps, 4 arms × 4 seeds)

Run via `deno run -A experiments/oligomer/phage-gpu-run.ts --size 128 --steps 20000 --seeds 4 --census 500` (~2,100–2,800 steps/s on Apple Silicon WebGPU; ~7–10 s per 20k-step run):

| Arm (`128×128`, 20k steps) | Late droplets (s1–s4) | Hill $D_1$ (late) | `sw25` (late) | `lagR` (s1–s4) | `nfdsR` (s1–s4) | `res` |
|---|---|---|---|---|---|---|
| **`PHAGE` (motif-specific)** | **65.4, 70.1, 70.3, 69.8** | **4.50, 4.80, 4.40, 4.84** | **8, 9, 6, 9** | **+0.77, +0.84, +0.79, +0.79** | **-0.29, -0.28, -0.27, -0.24** | `0` |
| `NO_PHAGE` (no phage) | 61.0, 58.8, 64.0, 64.7 | 5.57, 5.33, 4.65, 5.85 | **0, 2, 0, 0** | n/a | +0.04, +0.04, +0.04, -0.15 | `0` |
| `SINGLE_WALL` (1 motif + phage) | **20.5, 17.7, 24.6, 17.3** | **1.00 (all 4)** | **0, 0, 0, 0** | n/a | n/a | `0` |
| `NEUTRAL_PHAGE` (motif-blind) | **10.0, 13.2, 18.9, 17.3** | **2.95, 2.60, 2.85, 3.38** | 9, 8, 1, 5 *(crash bottlenecking)* | n/a | -0.23, -0.15, -0.08, -0.24 | `0` |

*(Post-review spot-check with `noiseQ8` overflow fix + independent circular half-period time-shift null on `128×128` `PHAGE` s1: `drop = 76` [late `69.0`], `D1 = 4.56`, `sw25 = 10`, `lagR = +0.82` vs time-shift `null = +0.09`, `nfdsR = -0.28`, `res = 0`, `2,218 steps/s`.)*

## `256×256` Scale Test (10,000 steps, `PHAGE` s1)

- **Throughput:** `6.6 s` for `10,000` steps (**1,508 steps/s** across 65,536 tiles × 14 integer channels).
- **Emergent ecology:** **287.3 late droplets** (`296` at `t = 10k`), **`D1 = 5.54`**, **`lagR = +0.89`**, **`nfdsR = -0.40`**, **`res = 0`**.

## Key Takeaways

1. **4/4 non-overlapping separation across all controls at `128×128`:**
   - vs **`NEUTRAL_PHAGE`**: `PHAGE` sustains **4.5× more droplets** (`65–70` vs `10–19`) and much higher diversity (`D1 = 4.40–4.84` vs `2.60–3.38`) while driving motif-specific host–parasite tracking (`lagR = +0.77..+0.84`).
   - vs **`NO_PHAGE`**: `PHAGE` drives sustained major motif sweeps (`sw25 = 6–9` vs `0–2`) and consistent negative frequency-dependent selection (`nfdsR = -0.24..-0.29` vs `+0.04..+0.04, -0.15`).
   - vs **`SINGLE_WALL`**: Multi-motif wall diversity rescues droplets 3.5× (`65–70` vs `17–25` droplets).
2. **Exact conservation (`res = 0` on `24×24` through `256×256`) and verified bit-exact CPU↔GPU parity (`24×24`, `32×32`, `128×128` golden cases).**
