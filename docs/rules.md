# Rules (RULE_VERSION 1)

The executable specification is `packages/sim-ref/src/step.ts`; the WGSL kernels in `packages/sim-gpu/src/shaders.ts` must match it bit for bit, which `packages/sim-gpu/src/golden.ts` checks on every WebGPU host and `packages/sim-ref/test/golden-hashes.test.ts` pins. This page explains the rules in prose and records the arithmetic-bounds argument.

## State

Each cell of a `tileW × tileH` torus (a world may hold several independent tiles) stores u32 channels:

| channel | meaning | moves by |
|---|---|---|
| A | dissolved nutrient (matter) | diffusion, gated by membrane |
| B | biomass (matter; carries the genome) | Flow-Lenia reintegration |
| C | dissolved waste (matter) | diffusion, gated by membrane |
| P | structural polymer / membrane (matter) | reintegration, with B |
| E | free-energy pool | reintegration, with B |
| S | signal (stored energy) | diffusion |
| MOT | controller motility output | copied with the genome winner |

and a 44-word genome: lineage id (hi, lo), Lenia growth parameters μ and σ, motility gain, and 160 int8 controller weights (10 → 8 → 8 network).

Potential energies `eA ≤ eC < eB < eP` make every reaction balance: matter is conserved exactly, and energy content + exported heat − absorbed light is invariant.

## One step

1. **Affinity.** `U = G(K ∗ (B+P); μ, σ)` with a ring kernel `K` of radius R (integer table built with BigInt) and a polynomial Lenia growth function, all in integers. μ, σ come from the cell's genome (defaults for empty cells or in neutral runs).
2. **Flow.** Displacement `dt((1−α)∇U − α∇M)` (Sobel gradients, `α = min(1, (M/θ)²)`), plus the controller's motility × gain. All signed divisions truncate toward zero, so the rules are mirror-symmetric.
3. **Transport.** Each source spreads its B, P and E over the cells covered by a box of half-width `32 + spread` (in 1/64 cell) centred on its displacement. Shares are `floor(q·w/D²)`; the source keeps the remainder, so conservation is exact. The target's genome is chosen by a lottery weighted by incoming bound mass (counter-based PRNG keyed on seed, step and cell). Genomes are immutable per lineage id, so a destination that already holds the winner's lineage is not rewritten. A, C and S diffuse with quarter-portion stochastic rounding. A and C are gated by `gateK / (gateK + P_s + P_t)`.
4. **React.** The controller reads local chemistry, light, signal gradient and affinity. Catalysis runs in a fixed order: photosynthesis (A + light → B), respiration (B → C + E), decomposition (C → A + E), growth (A + E → B), polymer building (B + E → P) and signal emission (E → S). All catalysis uses the effective catalyst `B²/(B+K)`, an Allee effect. Then the work and maintenance costs are paid, with starvation when E runs short. Passive decays and light-driven abiotic recycling follow. Mutation happens per newly synthesised quantum and mints a new lineage id `(step+1, cell)`.

Every stochastic rounding uses `floor(x) + [frac(x) > rnd]` with a deterministic draw, so expectations are exact and the CPU and GPU agree.

## Bounds

The rules assume the following, enforced by `validateConfig` and `validateState` (at world construction, GPU upload, reference construction and checkpoint decoding):

- total world matter ≤ `MATTER_MAX = 2^26`, hence every matter channel and every per-reaction amount q ≤ 2^26;
- energies ≤ 31, hence `q · (energy gap) < 2^31`;
- `E, S ≤ POOL_MAX = 2^28` per cell. Excess is exported as heat at the start of `react` and after every E or S increase, so `E + q·gap ≤ 2^28 + 2^26·31 < 2^32`;
- after transport, `E ≤ 9 · 2^28 < 2^32` (at most nine sources contribute);
- products with rates use `mulShr(a, b, s) = (a >> s)·b + ((a & mask)·b >> s)`, exact when `(a >> s)·b < 2^32`. For `a ≤ 2^26`: rate ×127 (s=7), light ×255 (s=8), and the summed rates ×762 (s=7) all fit;
- `cat(B) = B − (K − ⌈K²/(B+K)⌉)` avoids the `B·K` product (K ≤ 65535);
- per-cell heat is accumulated as a 64-bit (lo, hi) pair on the GPU and as an exact JavaScript number on the CPU. Workgroup sums of light, heat, fluxes and statistics use carry-aware (lo, hi) accumulators;
- `step ≤ MAX_STEP = 0xFFFFFFF0`, so lineage ids `step + 1` never wrap.

The `extremes` golden case runs a world at these limits (total matter at `MATTER_MAX`, E and S at `POOL_MAX`, maximal leak and decay) on every WebGPU backend.

## Controls

`neutral` expresses one reference phenotype everywhere while lineages and mutations still propagate. `motility: false` disables active movement. Conditions in `packages/runner/src/conditions.ts` map these flags and parameters to the pre-registered controls.
