# Mycelium in a volume: rules, rung R0

Rule id `mycelium3d-r0`. This is the prose specification of `tools/mycelium3d/world.ts`, the CPU reference. The WGSL twin `tools/mycelium3d/gpu.ts` matches it bit for bit (`tests/deno/mycelium3d_gpu.ts`, 62 cases). At the guard limits the CPU throws before the step and keeps its state; the GPU runs the step and `read()` throws, as in the 2D twin, so that state is not usable. Plan: `docs/3d-expansion-plan-2026-11-15.md` (in the `browser-life-3d-plan` checkout, not yet on main), Phase 1 B1 and B2 (section 3, "What depth adds to mycelium").

This rule set copies the 2D mycelium world (`tools/mycelium/RULES.md`, rule `mycelium-r0`) and changes only what is listed here. It is a separate rule set: it does not import `tools/mycelium/` (the small pure helpers `conduitRate`, `ownerRate`, `resolveClaims`, `ownerTag` and `shiftCell` are copied, so this rule does not move when the 2D one does), and the research kernel's `RULE_VERSION` and golden pins are untouched. From the kernel it reuses the integer helpers and counter-based PRNG (`@bl/schema` `int.ts`) and the slab's six-way diffusion split (`diffOut6` in `@bl/sim-ref`, `packages/sim-ref/src/step3d.ts`).

## What exists

**The field** is a grid of `width × height × depth` cells (W × H × D). x and y wrap; z is closed. Layer 0 is the surface, where light enters, and layer `D − 1` is the floor. Cell `(x, y, z)` has index `(z · H + y) · W + x`. Each cell holds three u32 amounts:

- **A**: dissolved nutrient. It carries chemical energy, `eA` per unit.
- **C**: dissolved waste. No chemical energy.
- **P**: trail, the polymer particles lay down. No chemical energy.

**Particles** have:

- a unique id, a parent id and a genotype id;
- a fixed-point position `(x, y, z)` (one cell is 256 units on each axis);
- matter `M` (always at least 1 while alive);
- energy `E` (at most `energyMax`);
- an age;
- a controller of 13 inputs, 8 hidden units and 9 outputs: 193 int8 weights, stored in a 196-byte record (49 u32 words) whose last 3 bytes are padding and always 0.

Slot order equals id order.

**Closed in matter, open in energy.** The matter total ΣA + ΣC + ΣP + ΣM never changes. Energy, ΣE + eA·ΣA, changes each step by exactly `lightIn − heat`. Light is the only input, and heat is the only output. C and P are not in the energy total, so moving them (sinking, diffusion of C) moves matter only and never energy. That is why no rule turns waste into nutrient without light: it would create `eA` per unit and break the ledger.

## The light plane

Light is carried in 1/256 units of conversion. The plane `I` is computed once per step from the **start-of-step** state (phase 1), and the sensor (phase 2), the conversion (phase 8), `probe`, `lightPlane` and the census all read this one plane.

- **Surface** (layer 0): `I = light << 8` (uniform), or `I = floor((light << 8) · (x + 1) / W)` (gradient).
- **Shading matter** of a cell: `m = min(P + Mb, MCAP)`, with `Mb` the sum of `M` over the particles binned in the cell at the start of the step and `MCAP = 16383` (the slab's cap).
- **Below the surface**: `I(z) = (I(z − 1) · T(m(z − 1))) >> 8` with `T(m) = floor(256 · lightK / (lightK + m))`, the slab's form (`packages/sim-ref/src/step3d.ts`, `lightColumn`). A cell does not shade itself, only the cells below it. Empty water is lossless: `m = 0` gives `T = 256`.

The slab applies the same form to an integer light `L ≤ 255`. Here `light` is usually 1, so on whole units any shading would floor the next layer to 0; carrying `I` in 1/256 units keeps the expected light exact down the column, and rounding happens only at conversion. Zero light gives `I = 0` everywhere and converts exactly nothing.

## One step

Every phase reads the state as the previous phase left it. Phases 2–5 are order-free per particle: their only shared writes are additions into field cells, which commute. Phase 7 is the only phase that depends on order, and it uses a prefix sum over slot order.

1. **Bin.** Each particle's cell is `((z >> 8) · H + (y >> 8)) · W + (x >> 8)`. The crowding count `crowd[cell]` is the number of particles in the cell, and `Mb[cell]` the sum of their matter. (`D` is the depth throughout this note; the 2D note's crowding `D` is `crowd` here.) Then the light plane is computed (above).
2. **Sense** (start-of-step field). The thirteen inputs, each saturated to 0..127 or clamped to ±127, are:
   - 0–9: as in 2D, within the particle's layer: nutrient, waste and trail here (`>> sensorShift`); the trail gradients east − west and south − north; the nutrient gradients east − west and south − north; `E >> energyShift`; `M >> massShift`; `16 · crowd`.
   - 10: the trail gradient down − up, `sat(P_down >> sensorShift) − sat(P_up >> sensorShift)`, clamped to ±127. Down is layer `z + 1`, up is layer `z − 1`: +z minus −z, as east − west is +x minus −x, and the slab's below − above. A neighbour outside the volume reads the cell's own value (the slab's rule), so at the surface the input is `sat(P_down) − sat(P_here)`, and with `D = 1` it is always 0.
   - 11: the nutrient gradient down − up, the same way.
   - 12: the light here, `floor(I · 127 / (light << 8))`, 0 when `light` is 0. It is 127 under an unshaded surface (in the gradient pattern, only the east column reaches 127).
3. **Think.** Run the 13 → 8 → 9 controller (below). The outputs read are 0 MX, 1 MY, 2 EAT, 3 DEPOSIT, 4 SPLIT and 8 MZ. Outputs 5–7 are reserved.
4. **Eat.** As in 2D, per 3D cell (including the eating gate when `ownerDefend` is set).
5. **Live.** As in 2D, with two changes:
   - the movement term is `((|MX| + |MY| + |MZ|) · moveCost) >> 7` (and the toll form below takes `raw = (|MX| + |MY| + |MZ|) · moveCost`). MZ is paid in full even when the clamp at a wall stops the motion;
   - the move adds `trunc(MX · speed / 128)` to x and `trunc(MY · speed / 128)` to y, wrapping, and `trunc(MZ · speed / 128)` to z, clamped to `[0, D · 256 − 1]`. Positive MZ moves down, toward the floor (z grows), as positive MX moves east. With the z inputs written down − up, the sign relation is the same on all three axes: a positive weight from input 10 (or 11) to MZ steers toward more trail (or nutrient), as a positive weight from input 3 to MX steers toward trail to the east.

   All field writes in this phase are to the 3D cell the particle started the step in.
6. **Compact.** Survivors keep their slot order.
7. **Births.** As in 2D. The child is placed within ±128 units of the parent on each of the three axes from the parent's draws: x and y wrap, `z = clamp(z_parent + (draw(DZ) & 255) − 128, 0, D · 256 − 1)`.
8. **Field**, in this order:
   1. **Light and decay**, per cell: `L = (I >> 8) + [draw(field, LIGHT) & 255 < (I & 255)]`, then light converts `min(C, L)` waste into nutrient, and `lightIn` grows by `eA` per unit. Trail decays to waste by `mulFrac(P, pDecay, 16, draw(field, DECAY))` (and owned trail with the same draw, as in 2D).
   2. **Sinking** (only with `sinkShift`; below).
   3. **Diffusion** of A (with the conduit rules, which read P and the owner planes as sinking left them), then of C.

## The controller

Inputs `x[0..12]`, hidden `h[0..7]`, outputs `o[0..8]`. Layout of the 193 weight bytes: `W1` (13 × 8, input-major: byte `i · 8 + j`) at 0, `B1` (8) at 104, `W2` (8 × 9, hidden-major: byte `112 + j · 9 + k`) at 112, `B2` (9) at 184. Bytes 193–195 are padding, always 0 (`validateState` checks).

The arithmetic is the kernel's (`controllerForward`, `controllerForward3`), widened:

```
h[j] = clamp(divi(128 · B1[j] + Σ_i W1[i][j] · x[i], 128), 0, 127)
o[k] = clamp(divi(128 · B2[k] + Σ_j W2[j][k] · h[j], 128), −127, 127)
```

`divi` truncates toward zero. Neither kernel forward takes a width, so `world.ts` has its own `controllerForward13`. Bounds: `|acc| ≤ 127 · 128 + 13 · 127 · 127 < 2^18`.

**Lift.** `liftMyceliumGenome(g2)` takes a 2D genome (160 bytes, 10 → 8 → 8) and returns the 3D record: `W1[i][j]` for `i < 10`, `B1`, `W2[j][k]` for `k < 8` and `B2[k]` for `k < 8` are copied by (i, j) and (j, k), never by byte offset; rows 10–12 of `W1`, column 8 of `W2`, `B2[8]` and the padding are 0. A lifted net's hidden units ignore inputs 10–12, its outputs 0–7 equal the 2D net's on inputs 0–9, and its MZ is 0, so it moves only in x and y.

**Founders** and **blocked** children draw all 193 weight bytes uniformly in `[−weightSpan, weightSpan]` at slots `100 + b`; padding stays 0. A blocked child always gets a new genotype id, even in the (very unlikely) case that its redraw equals its parent's weights byte for byte; no comparison is made. This is the exception to "a child whose controller differs gets a new id", and it is the 2D rule's behaviour too. **Mutation** picks weight byte `draw(MUT_SLOT + j) % 193`; the padding is never mutated.

## Sinking (optional `sinkShift`)

Integer 1..16. Absent means no sinking. Each step, after light and decay, every cell above the floor (`z < D − 1`) sends

```
sC = mulFrac(C, 2^(16 − sinkShift), 16, draw(field, SINK_C))
sP = mulFrac(P, 2^(16 − sinkShift), 16, draw(field, SINK_P))
```

to the cell directly below (about `C / 2^sinkShift`, stochastically rounded; the remainder stays). Every send is computed from the post-decay amounts before any is applied, so matter moves at most one layer per step. The floor sends nothing and keeps what reaches it. A send never exceeds the amount (`mulFrac(q, k, 16, r) ≤ ceil(q · k / 2^16) ≤ q` for `k ≤ 2^15`). A and the particles do not sink.

Owned trail (only with `trailOwner`): `Q −= min(Q, mulFrac(Q, 2^(16 − sinkShift), 16, draw(field, SINK_P)))` with the same draw as P, and `Z = 0` when Q reaches 0. What sinks loses its owner: arriving trail adds to P only. `Q ≤ P` survives by the 2D decay argument (`q − mulFrac(q, k, 16, r)` is non-decreasing in q for `k < 2^16`, and arrivals only raise P).

Matter moves between cells, so ΣA + ΣC + ΣP + ΣM is unchanged; C and P carry no energy, so `ΣE + eA·ΣA` is unchanged too.

## Diffusion

A and C diffuse to the six face neighbours with the slab's `diffOut6`: a cell splits its amount `q` into six portions `q / 6`, plus one for `q mod 6` of the directions chosen by a rotation from the draw, and sends `mulFrac(portion, 4 · Dd, 10, rnd)` toward each neighbour. Directions are 0 +x, 1 −x, 2 +y, 3 −y, 4 +z (down), 5 −z (up). A portion aimed outside the volume in z is not sent and stays with its source. The draws come from `cellBase(seed XOR 0x64696666, step, cell)`, with the species index keeping A and C apart (the slab's slots `DIFF + d · 3 + species` and `DIFF_ROT`). Sends are written to a scratch plane and gathered, so nothing depends on order.

The total a fully interior cell sends is about `q · Dd / 256`, as in 2D (six portions of `q / 6` at `4 · Dd / 1024`). Each face gets two thirds of the 2D per-face rate. Two limits, as in 2D:

- **Base rate.** `diffA` and `diffC` are in `[0, 256]`, so `4 · De ≤ 1024`: `mulFrac(portion, 4 · De, 10, rnd)` never exceeds the portion, and a cell never sends more than it holds. At 256 an interior cell sends about all of it (the checkerboard mode is then at −1, as in 2D, where the same range is allowed).
- **Conduit rate.** With `trailConduit` or `ownerConduit`, `diffA ≤ 128` is required and every per-edge rate is capped at `Dd ≤ 128`, so `4 · Dd ≤ 512`, and the checkerboard eigenvalue `1 − 2 · Dd / 256` stays at or above 0.

## Levers (optional keys, absent by default)

All are absent from `defaultConfig()` and never inserted by `createWorld`. Every "requires" and "excludes" rule lives in `validateConfig`. Each is the 2D rule of the same name (`tools/mycelium/RULES.md`) applied per 3D cell, with these readings:

- **Toll road**: `trailMoveDiscount` (0..256) and `trailDiscountMode` (`"public"` or `"toll"`). `f = min(min(P0, 256) · td, 256)` from the start-of-step trail in the particle's own 3D cell; the movement term becomes `(raw · (256 − f)) >> 15` with `raw = (|MX| + |MY| + |MZ|) · moveCost`. Bounds: `raw ≤ 381 · 2^12 < 2^21`, `raw · 256 < 2^29`.
- **Trail conduit**: `trailConduit` g (0..255, requires `diffA ≤ 128`) and `trailConduitCap` q (1..255). Species A only, on all six faces: `Dd = min(diffA + ((min(P[k], P[nb], q) · g) >> 4), 128)`, with P as sinking left it. A missing z face carries nothing.
- **Conduit ghost**: `trailConduitGhost` s (1..min(W, H) − 1): the rate reads P at `shiftCell(k, s)` and `shiftCell(nb, s)`, a translation by (+s, +s) within the same layer.
- **Owner planes and gate**: `trailOwner` (`"id"` or `"gid"`) adds `Z` (owner tag, `ownerTag(v) = v + 1`) and `Q` (owned trail) per 3D cell; `ownerDefend` θ (1..255) is the eating gate (a cell owned by a stranger with `Q ≥ θ` zeroes my request before it is summed); claims are resolved per 3D cell by the two-pass max of 2D.
- **Owner conduit**: `ownerConduit` g (0..255, requires `trailOwner` and `diffA ≤ 128`, excludes `trailConduit`), `ownerConduitCap` q (1..255) and `ownerGhost` s (1..min(W, H) − 1), on all six faces: `Dd = (Z[k] ≠ 0 and Z[k] = Z[nb]) ? min(De + ((min(Q[k], Q[nb], q) · g) >> 4), 128) : De`, reading Z and Q after decay and sinking.

The diffusion of A is skipped only when `diffA` is 0 and neither conduit key is present.

**Not ported** (2D keys this rule rejects as unknown): `controller` / physarum, `physarumDeposit`, `blindTrailGradient`, `trailInit`, `trailInitPattern`, `trailInitPitch`, `trailFreeLayer`. They can be added later as optional keys.

## Randomness

All draws use `draw(cellBase(seed', step, key), slot)` from `int.ts`:

- **Particle streams** use `seed' = seed XOR 0x6d796331` and key = particle id. Founders use step `0xffffffff`.
- **The field stream** uses `seed' = seed` and key = the 3D cell index.
- **The diffusion stream** uses `seed' = seed XOR 0x64696666` and key = the 3D cell index.
- **Particle slots:** 0 DX, 1 DY, 2 mutate?, 3+j mutation slot, 40+j mutation delta, 90 upkeep rounding, 91 excretion rounding, 92 DZ, 100+b weight byte (b < 193).
- **Field slots:** 0 decay, 1 light rounding, 2 sinking C, 3 sinking P (and owned trail).

## Bounds

`validateConfig` enforces every range below, and `validateState` checks counts, positions, the genome padding, the owner invariants and both ledger identities.

- **Shape.** `8 ≤ W, H ≤ 512`, `1 ≤ D ≤ 64`, `W · H · D ≤ 2^24`. Positions are below `512 · 256 = 2^17` in x and y and `64 · 256 = 2^14` in z.
- **Total matter ≤ 2^31.** This bounds every field cell, every sum of cells and `P + Mb`, so u32 never wraps.
- **Light.** `light ≤ 2^12`, so `I ≤ 2^20`; `T ≤ 256`, `I · T ≤ 2^28`; `lightK` in `[1, 65536]`, so `256 · lightK ≤ 2^24` and `lightK + m < 2^17`; the gradient product `(light << 8) · (x + 1) ≤ 2^29`; the sensor product `I · 127 < 2^27`.
- **The contended grant `r · A`.** As in 2D: `r ≤ 253`, `maxParticles ≤ 2^16`, so `r · A < 2^32`.
- **Controller.** `|acc| < 2^18`.
- **Movement.** `|MX| + |MY| + |MZ| ≤ 381`, `moveCost ≤ 2^12`, so `raw < 2^21`, and the toll product `< 2^29`.
- **Diffusion.** Base rate: `De ≤ 256`, `4 · De ≤ 1024 < 2^22`. Conduits: `diffA ≤ 128` and `Dd ≤ 128`, so `4 · Dd ≤ 512`; `min(P, P, q) · g ≤ 255 · 255 < 2^16` (the min before the multiply).
- **Sinking and turnover.** `mulFrac(q, 2^(16 − k), 16)` with `k ≤ 2^15 < 2^16`, exact for any u32 q.
- **Lifetime ledger.** As in 2D: `energy0`, `lightIn` and `heat` each at most 2^50; `step` throws when a run would cross it (after the step's work, so the run is over). The state left by that throw is not kept consistent: the step's work is done but the totals are not recorded, so its energy residual is not 0. This is a known limit, not a bug to rely on. At the default world's light input a run would need on the order of 10^11 steps to reach 2^50; do not continue from a state after this throw.
- **State.** `validateState` (and so `decode`) requires `step`, `n`, `nextId`, `nextGid`, `matter0`, `energy0` and every counter in `totals` (`lightIn`, `heat`, `births`, `deaths`, `refused`, `contended`, `mutations`, and no other key) to be non-negative integers: `step ≤ 2^53 − 1`, `matter0 ≤ 2^31`, counters `≤ 2^50`, ids `≤ 0xffffffff`. It requires the total matter to be at most 2^31 (which bounds every cell, since amounts are u32), and `1 ≤ M ≤ bodyMax` for every particle.
- **Particle age.** `age` is a u32 and wraps to 0 after 2^32 − 1 steps (the GPU twin's u32 arithmetic does the same). No rule reads age (it is a record only), so wrapping changes no dynamics, and it is far beyond any run.
- **Counters while stepping.** `step` refuses to start (throws, the state unchanged) when `step` is already `2^53 − 1` (so the counter stays a safe integer), or when `births`, `deaths`, `refused`, `contended` or `mutations` is above `2^50 − max(cells, maxParticles)`, the most any of them can rise in one step. No counter ever saturates silently.

## What D = 1 is

With `D = 1` and every 3D-only key off (`sinkShift` absent), a step is close to the 2D world's but not equal, and digests are not comparable:

- **Diffusion** uses sixth-portions with the two z faces missing, so a cell sends about `q · Dd / 384` in total (4 of 6 portions) instead of `q · Dd / 256`: each face gets two thirds of the 2D rate. The portion split and the draw slots differ from 2D's `diffOut`, so the bytes differ even at the same rate. Doubling `diffA` does not make it exact.
- **Light.** Uniform light converts exactly `light` per cell, as in 2D (there is no layer above, and `I & 255 = 0`). The gradient pattern differs: 2D rounds `light · (x + 1) / W` stochastically by a draw `mod W`; here the surface is floored to 1/256 units first and rounded by a draw `& 255`. The expected light differs by less than 1/256 unit per cell.
- **Inputs.** The z gradients (10, 11) are always 0. The light input (12) is 127 under uniform light, a constant the founders' random row-12 weights see as a bias.
- **Controller and founders.** The record is 196 bytes, not 160, so founder weights (slots `100 + b`) and mutation slots (`% 193`) differ from 2D; a world of lifted 2D founders would behave like 2D in its outputs 0–7, but `createWorld` draws native ones.
- **MZ** costs energy even though the clamp keeps z at 0 (`z ∈ [0, 255]`; a particle can move inside its one layer, which bins it in the same cell).
- **Births** draw a DZ offset that the clamp may change, but which cannot leave the layer.

Everything else (eating, live, compaction, births, decay, the toll, the conduit and owner rules within the layer) is the 2D arithmetic.

## Defaults are engineered choices

`defaultConfig()` is sized for a 32 × 32 × 16 world (16,384 cells, the cell count of the 2D 128 × 128 default). Every 2D default (founders 1024, `nutrient0` 48, `light` 1, `upkeep` 6, `pDecay` 655, `diffA` and `diffC` 40, the heredity and sensor scales) is copied unchanged; founders are placed uniformly through the volume. The one new number is `lightK`, set to 64.

**Tuning, 15 Nov 2026** (seed 1, 20,000 steps, `tools/mycelium3d/run.ts`, ledger residual 0 on every step). With `lightK` 256 the floor still received about 35–37% of the surface light, so depth barely shaded; at 64 the floor receives about 18–20% and the light falls steadily with depth, mostly from body matter (trail was nearly purged at 64). Both lived:

| lightK | sinkShift | Particles at 2k … 20k | Floor light (/256) | Floor waste C / surface C |
|---|---|---|---|---|
| 256 | absent | 3,954 … 3,765 | 87 | 21,957 / 18,542 |
| 256 | 6 | 3,331 … 3,365 | 94 | 128,080 / 1,348 |
| 64 | absent | 2,961 … 3,039 | 45 | 18,697 / 31,790 |
| 64 | 6 | 2,607 … 2,688 | 51 | 152,416 / 3,380 |

The table above was measured before inputs 10 and 11 became down − up (same day). On the final rule, `lightK` 64: without sinking, 3,026 to 3,143 particles from step 2,000 to 20,000, floor light 59/256, floor waste 28,124 against 26,455 at the surface (digest `cf386b9e281b26f7`); with `sinkShift` 6, 2,535 to 2,673 from step 4,000, floor light 57/256, floor waste 157,017 against 1,285 at the surface (digest `f3c30c277b817889`). Trail is purged almost everywhere in both.

Sinking piles waste on the floor and starves the surface of the waste light needs, as `docs/3d-expansion-plan-2026-11-15.md` section 3 expects; the population still holds. These values are choices that make the world run. They are not findings about it.

## Checkpoints

`encode` writes the magic `BLM3`, a JSON header (format 1, config, step, counters and ledger anchors), then A, C and P, the nine u32 particle arrays (id, parent, gid, x, y, z, M, E, age), the live genome records (196 bytes each) and, only with `trailOwner`, the owner planes Z and Q. `decode` validates the result. `stateDigest` is two FNV-1a lanes over those bytes. A run resumed from a checkpoint equals the continuous run byte for byte (`tools/test/mycelium3d.test.ts`).

## Not in R0

Rendering, upwelling, floor decomposition, and every 2D rung after R0 except the levers above.
