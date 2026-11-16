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
2. **Flow.** Displacement `dt((1−α)∇U − α∇M + kAdhesion·∇P)` (Sobel gradients, `α = min(1, (M/θ)²)`; the `∇P` term only when `adhesion` is on, the same Sobel shape over structural polymer `P` alone, pulling a cell toward denser nearby polymer, and scaled by `dt` like the other two terms), plus the controller's motility × gain, which is *not* scaled by `dt`. Adhesion is a tested single-step attraction (see `packages/sim-ref/test/adhesion.test.ts`); its effect on holding a moving colony together is not demonstrated — see `WorldConfig.adhesion` for what an exploratory multistep test did and did not show. All signed divisions truncate toward zero, so the rules are mirror-symmetric.
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
- `step ≤ MAX_STEP = 0xFFFFFFF0`, so lineage ids `step + 1` never wrap;
- the adhesion term's `kAdhesion · ∇P` is bounded by `kAdhesion ≤ 1024` and `|∇P| ≤ 4·16383 = 65532` (P capped the same way M already is for `∇M`), so the product stays under `2^26`, the same safety margin as the existing `α · ∇M` term.
- the capability-gene maintenance term (`WorldConfig.genes`, the game kernel line; absent in every RULE_VERSION 1 world) is one `mulFrac(B, kGene, 16)` with `kGene ≤ 65535`, bounded exactly as `kMaint`'s (≤ `B` ≤ `2^26`), times the number of genes carried; the gene byte holds at most 8, so the gene term is at most `2^29` and the cost sum (`2^29` work + `2^26` kMaint + `2^29` genes) stays under `2^31`. The count multiplies the term rather than `kGene`, which keeps `mulFrac`'s `k < 2^16` exactness. The `genes-bounds` golden case runs the three cost terms at their maximum rate constants on heavy biomass (`MATTER_MAX / 128` per cell), not at the full `2^26` per-cell extreme, and `genes-ladder-bounds` does the same with two carried genes (the "ladder" set). Gene v2's `geneDrive` (a floor, at most 127, on a build carrier's rectified BUILD output in its building capacity and work term) keeps that output at most 127, so no bound changes; `genes-drive-bounds` runs it at 127 on the same heavy biomass.

The `extremes` golden case runs a world at these limits (total matter at `MATTER_MAX`, E and S at `POOL_MAX`, maximal leak and decay) on every WebGPU backend.

## Controls

`neutral` expresses one reference phenotype everywhere while lineages and mutations still propagate. `motility: false` disables active movement. `adhesion: false` (the default) disables the polymer-gradient attraction term in flow, so a disabled world steps bit-identically to a build without the flag. There is no free controller output or genome slot for a dedicated adhesion signal without changing genome layout, so adhesion is derived from the existing "deposition of structural polymer" actuator (BUILD/P, see docs/plan.md decision 4) instead of adding one. Conditions in `packages/runner/src/conditions.ts` map these flags and parameters to the pre-registered controls.

Recurring injury (`injuryPeriod`, `injuryRadius`, `injuryProb`; optional, absent in every RULE_VERSION 1 world) ends the react phase of every `injuryPeriod`-th step by lesioning each cell within `injuryRadius` of a wound centre, after the passive decays: B and P become waste C, their excess chemical energy and E leave as heat, motility resets and the lineage clears. With the optional `injuryShell` (integer 1..65535, valid only with the three injury keys) a wounded cell whose post-decay polymer `P >= injuryShell` is not lesioned: the wound takes exactly `injuryShell` polymer (`P -= s`, `C += s`, heat `+= s·(eP − eC)`) and B, E, motility and the lineage are kept (the lineage stays even when the shell takes the cell's last polymer and leaves B = P = 0: the empty-cell cleanup skips a shelled cell); a cell with less polymer is lesioned as above. Both branches use the same u32 terms as the lesion (`s ≤ P`), so no bound changes, matter is conserved and the ledger closes. The `injury-shell` golden case runs both branches.

## The slab

The slab (rung 1b, `docs/3d-rung1b-plan-2026-10-23.md`; per-pass arithmetic in `docs/3d-rung1b-step-spec.md`) is a different rule line from RULE_VERSION 1: one `tileW × tileH × tileD` tile (`tileD` set, with `lightK`; `tileD` a multiple of 4 from 4 to 32, or 64 for the jar; `kernelRadius` 3, `tilesX = tilesY = 1`, light mode `uniform` or `gradient`). x and y wrap, z is closed: layer 0 is the surface where light enters, layer `D − 1` is the floor. The executable specification is `packages/sim-ref/src/step3d.ts` (`RefSim3`); its WGSL twin is `shaders3d.ts` in `@bl/sim-gpu`. The 2D files are untouched and every RULE_VERSION 1 hash is unchanged. Not defined for a slab (rejected by `validateSlab`): takeover, injury, shape rings, genes, adhesion, wander and day period, cells, migration, ponds, ring namespace.

Same state shape as 2D with `i = z·W·H + y·W + x`, channel-major cells, and a 49-word genome (lineage, `mu | sigma << 16`, motility gain, 45 words of 177 int8 weights; the controller is 11 → 8 → 9, adding the `SGZ` input and the `MZ` output). `MOT` packs three biased bytes. Matter conservation is exact and the energy residual is exactly zero, as in 2D.

One step: **affinity** (92-tap 3D kernel, outside mass 0, divided by the full tap sum, so a wall cell sees what it would beside empty water), **flow** (27-point Sobel `/4` of `U` and mass with replicate padding at the walls; three displacement bytes), **transport**, **light**, **react**, tick.

- **Transport.** Each source spreads `B`, `P`, `E` over the 27 cells covered by a box of half-width `hw = 32 + spread`, by three nested exact shares `share3(q, wx, wy, wz) = mulShareD(mulShareD(mulShareD(q, wx, D1), wy, D1), wz, D1)` with `D1 = 2·hw` (x, then y, then z). A source's stay is `q` minus the shares it sends to real cells; the portion aimed through a z wall stays, so nothing crosses `z = 0` or `z = D − 1`. The genome lottery scans 27 sources in the fixed order `k = (oz+1)·9 + (oy+1)·3 + (ox+1)`; a missing source has lot 0. A, C and S diffuse in six directions (sixth portions rotated by `draw(DIFF_ROT) % 6`); a direction that leaves the slab does not exist.
- **Light.** `L(x, y, 0)` is the 2D surface light (`lightBase`, mode, season); under mass the next layer sees `L · T(m) >> 8` with `T(m) = ⌊256·lightK / (lightK + m)⌋` and `m` the capped post-transport `B + P` of the cell directly above. Empty water is lossless and `Lbuf` is derived each step, never state.
- **React.** The 2D reaction order with `POOL_MAX3`; the `SGZ` sensor reads `S(below) − S(above)` and a missing neighbour reads the cell's own `S`. Mutation has 180 slots (177 weights, `mu`, `sigma`, motility gain).

Bounds the slab relies on (`validateState` enforces the state side: matter ≤ `MATTER_MAX`, `E, S ≤ POOL_MAX3 = 2^27`, reserved genome bytes zero):

| quantity | bound | why |
|---|---|---|
| affinity `conv` | ≤ 9624 · 16383 < 2^28 | taps ≤ 255, mass ≤ 16383, weights sum to 9624 |
| Sobel numerators | `\|G\| ≤ 16 · 16383` (mass), `≤ 32 · 256 = 8192` (U, signed in [−256, 256]), `/4` after | 16 is the total smoothing weight per side; the signed U difference spans both sides, so `\|gU\| ≤ 2048` |
| `(256−α)·gU`, `α·gM`, `dtQ·F` | ≤ 256 · 2048 = 2^19, ≤ 2^24, ≤ 2^28 | i32 safe (the 2D gU bound is 1024, the slab's is 2048) |
| displacement bytes | `dmax = 64 − spread`, byte ∈ [spread, 128 − spread] (spread ∈ [0, 32]) | so `\|d\| + hw ≤ 96` |
| transport weights | each `w ≤ D1 ≤ 128`, `Σ_o w(o) = D1` | |
| `mulShareD` split form | `(q mod D1) · w < 2^14`, `(q / D1) · w ≤ q` | exact `⌊q·w/D1⌋`; the plain `q·w` overflows u32 for `E` near 2^27 |
| shares sent by a source | Σ ≤ q | each nested floor is ≤ the real product and the real products sum to `q`; stay `= q − Σ` cannot wrap |
| `inE` | ≤ 27 · 2^27 < 2^32 | `E ≤ 2^27` per source |
| `inB`, `inP`, lottery `cum` | ≤ 2^26 | matter bound |
| diffusion | six portions sum to `q`; `De·4 ≤ 1024`; `v ≤ 2^28 + 6` | inflow is six portions of neighbours ≤ 2^27 |
| light | `L ≤ 255`, `T ≤ 256`, `L·T < 2^16`, `256·lightK ≤ 2^24` | |
| `SGZ` input | `cap24(S)` difference · `signalGain ≤ 127` < 2^31 | as `SGX` |
| `E` during react | ≤ 2^27 + 31 · 2^26 < 2^32 before each re-cap | `q ≤ B ≤ 2^26`, gaps ≤ 31 |
| per-cell heat | 64-bit `(lo, hi)` on the GPU, exact number on the CPU | the entry-cap excess alone can reach 26 · 2^27 |
| `LIN_LO` | `< N ≤ 2^24` | slab lineage ids are `(step + 1, cell)` with no namespace |

`E` and `S` are re-capped at exactly the 2D sites (cell load, after respiration, after decomposition, after emission), with the excess exported as heat, so the invariant `E, S ≤ 2^27` holds after every step. `packages/sim-ref/test/step3d.test.ts` checks exact conservation over 200 random slabs, the walls, the light column and the neutral arm; `step3d-ops.test.ts` checks the hand examples and the z-mirror symmetry of the deterministic operators.


### Optional slab vacancy predation (Candidate 9, Amendment 3)

The experimental slab configuration requires `rpsTypes` (3..8), `rpsRate` (0..16384),
`rpsMin` (1..255) and `rpsKill: "vacancy"` together, with `mutRate: 0`. Absent keys
leave all existing physics and serialization unchanged. PARAM1 bytes 1 and 2 encode
an inherited type and beats-mask; the mask is mirrored in MOT bits 24..31. The top
PARAM1 byte stays reserved. This slice provides no type or edge mutation.

After transport and pool caps, before the controller and passive reactions, each
living victim counts its six face neighbours whose biomass reaches `rpsMin` and
whose mirror mask beats its type. x/y wrap; missing z faces do not count. Draw slot
40 kills with probability `min(65536, rpsRate * ndom) / 65536`. A victim with B=0
and P>0 is eligible. The vacancy moves all B+P to C and exports B(eB-eC)+P(eP-eC)+E
as heat; B, P and E become zero. It books no reaction flux. Subsequent abiotic
reaction sees the resulting C. A and S are untouched by the kill itself. Clearing
lineage also clears the mirror; otherwise the inherited mask is retained.

Matter stays in the cell. Each GPU heat term fits the existing bounds and is added
separately to the 64-bit accumulator. The CPU sums in exact integer range. This is
an opt-in research implementation, not evidence of adaptive evolution or a public
preset; see `experiments/3d-rps/RULES.md`, Amendment 3.

### Optional slab levers: sinking, floor decomposition, upwelling, and mutation with the vacancy kill (2026-11-16)

Step A2 of `docs/3d-expansion-plan-2026-11-15.md`. Every key below is optional, slab only (`validateConfig` refuses
it on a 2D config), and absent from `defaultConfig()`, so every existing config, shader text and pin is unchanged and
`RULE_VERSION` stays 1. Their arithmetic is in `docs/3d-rung1b-step-spec.md` section 17; the twins are `step3d.ts` and
`shaders3d.ts`. New draw slots, used only when their key is set: 41 `RPS_FLIP`, 42 `SINK`, 43 `FLOOR`,
44 `UPWELL_A`, 45 `UPWELL_C`.

Bound matter (`B`, `P`) moves only through flow and transport, so these levers act on the dissolved channels. All
three run in `react`, right after the pool caps at cell load, as a gather on the post-transport values: a cell
computes what it sends from its own value and its own draw, and what it receives by recomputing the sender's amount
from the sender's value and the sender's `cellBase`. Nothing depends on the order in which cells run, and no new
pass, buffer or binding exists. Potential energy per quantum (`eA`, `eC`) does not depend on depth, so moving `A` or
`C` between cells changes no energy content and books no heat.

- **`sinkShift`** (1..16). Waste `C` is detritus (dead `B` and `P` decay into it), so it sinks. Each cell above the floor
  sends `mulFrac(C', 1, sinkShift, draw(SINK))` of its post-transport `C'` to the cell directly below: `C'/2^sinkShift`
  in expectation, with stochastic rounding, and the remainder stays. The floor layer sends nothing. Nutrient `A` does
  not sink: it is the dissolved solute, and sinking it would only starve the lit top by construction.
- **`floorDecay`** (0..65535, /65536 per step). In the passive processes, after abiotic recycling, a floor cell
  (`z = D − 1`) turns `q = mulFrac(C, floorDecay, 16, draw(FLOOR))` of its waste into nutrient: `C −= q`, `A += q`,
  heat `+= q·(eC − eA)`. This is downhill (`eC ≥ eA`), so the energy difference leaves as heat and the ledger stays
  exact. It is booked in the `abio` flux (abiotic `C → A`), which is the only flux it touches.
- **`upwellPeriod`** (1..2^31 − 1) **and `upwellShift`** (1..16), set together. On a step with
  `step mod upwellPeriod = upwellPeriod − 1` (the pre-increment step), each cell exchanges with its mirror
  `(x, y, D − 1 − z)`: it sends `mulFrac(A', 1, upwellShift, draw(UPWELL_A))` of its nutrient and
  `mulFrac(C' − sink, 1, upwellShift, draw(UPWELL_C))` of the waste it kept after sinking, and receives the mirror's two
  amounts. The mirror pairing is an involution with no fixed cell (`D` is even), so the exchange is a set of
  disjoint pairwise swaps: conservative, order-free and one read per cell. It is an overturn: floor water reaches the
  surface in one step, which a one-layer lift every `N` steps could not do against sinking every step. Waste is taken
  from what the cell kept after sinking, so sinking and upwelling together never send more than `C'`.
- **`rpsMutate`** (0..65536, /65536), only with the four vacancy-kill keys. It lifts the `mutRate 0` requirement of
  the vacancy kill; without it the requirement and every earlier refusal (`rpsFlip`, `rpsEdge`, a nonzero `mutRate`)
  stay. On a mutation event (the unchanged `draw(MUT) < p` test), `(draw(RPS_FLIP) & 0xffff) < rpsMutate` sends the
  event to the type operator of `docs/3d-cyclic-rps-plan-2026-10-23.md` section 4.4, otherwise to the ordinary
  controller mutation. With `t` the type, `m` the beats-mask, `other = (t + 1 + deltaRnd mod (K − 1)) mod K`: if
  `(which & 0xff) < 128` the event flips mask bit `other` (gain or lose one prey), else it relabels `t = other` and
  clears the new own bit `m &= ~(1 << other)`. The edge share is fixed at one half. Either way the event mints one
  lineage id `(step + 1, i)` and records one event, as any mutation does, and the MOT mirror is written from the
  genome after the mutation, so every RPS state invariant (`validateState`) holds. Mutation moves no matter or energy.

`InitParams` gets two founding options for `slab-spots` (not rules, absent from every preset): `surface` places every
founder's z in `0..surface − 1` instead of `0..D − 1` (x, y and the noise are unchanged), and `rpsCycle` gives founder
`f` type `f mod rpsCycle` with the cyclic mask `1 << ((t + 1) mod rpsCycle)` and the MOT mirror set.

Bounds: every amount sent is at most the sender's value (`mulFrac(q, 1, s) ≤ q` for `s ≥ 1`), so no channel wraps,
and a receiver's total is bounded by world matter (`≤ 2^26`). `q·(eC − eA) ≤ 2^26·31`, as the other decays. The
golden cases `jar-sink-*`, `jar-floor-decay-*`, `jar-upwell-*`, `jar-levers-*` and `slab-rps-mutate-*` run each
lever bit for bit (the 64-cube `jar-levers-cube-64x64x64` is gated in the vitest pins like the other cube).
